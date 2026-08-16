import { Bed, Ward, BillingLineItem } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import { createCharges } from './billingService.js';

/**
 * Admission logic: whether a bed may be given to a patient, and what a stay
 * costs.
 *
 * Kept out of the controller so the placement rules and the billing arithmetic
 * are testable on their own, and so admit, transfer and the nightly charge job
 * all agree.
 */

/** Local calendar date as YYYY-MM-DD — the unit a bed-night is billed in. */
export function dayKey(date) {
  const d = new Date(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Every calendar date touched by [from, to], inclusive of both ends. */
export function daysBetween(from, to) {
  const days = [];
  const cursor = startOfDay(from);
  const last = startOfDay(to);

  // A stay that starts and ends on the same date is one billable day.
  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Check a bed can take this patient, and return it with its ward.
 *
 * The gender rule is a real safety check, not paperwork: placing a patient on a
 * single-sex ward that does not match is a dignity and safeguarding incident,
 * so it is refused here rather than left to the admitting clerk.
 */
export async function assertBedAssignable({ bedId, wardId, patient, excludeEncounterId = null }) {
  const bed = await Bed.findOne({ _id: bedId, isActive: true });
  if (!bed) {
    throw ApiError.badRequest('That bed does not exist', {
      details: [{ field: 'bedId', message: 'Invalid bed' }],
    });
  }

  if (wardId && String(bed.wardId) !== String(wardId)) {
    throw ApiError.badRequest('That bed is not in the ward you named', {
      details: [{ field: 'bedId', message: 'Bed and ward do not match' }],
    });
  }

  const ward = await Ward.findOne({ _id: bed.wardId, isActive: true }).lean();
  if (!ward) {
    throw ApiError.badRequest('That ward is inactive');
  }

  // Already holding someone else?
  const heldByAnother =
    bed.currentEncounterId && String(bed.currentEncounterId) !== String(excludeEncounterId ?? '');

  if (bed.status === 'occupied' || heldByAnother) {
    throw ApiError.conflict(`Bed ${bed.bedNumber} is already occupied.`, {
      code: 'BED_OCCUPIED',
      details: { bedId: String(bed._id), status: bed.status },
    });
  }

  if (!['available', 'reserved'].includes(bed.status)) {
    throw ApiError.conflict(
      `Bed ${bed.bedNumber} is ${bed.status} and cannot take a patient until it is available.`,
      { code: 'BED_UNAVAILABLE', details: { status: bed.status } },
    );
  }

  if (ward.gender !== 'mixed' && patient?.gender && patient.gender !== ward.gender) {
    throw ApiError.conflict(
      `${ward.name} is a ${ward.gender} ward and this patient is recorded as ${patient.gender}.`,
      { code: 'WARD_GENDER_MISMATCH', details: { wardGender: ward.gender, patientGender: patient.gender } },
    );
  }

  return { bed, ward };
}

/** Put a bed into service for an encounter. */
export async function occupyBed({ bed, patientId, encounterId, user }) {
  bed.status = 'occupied';
  bed.currentPatientId = patientId;
  bed.currentEncounterId = encounterId;
  bed.updatedBy = user?._id ?? null;
  await bed.save();
  return bed;
}

/**
 * Release a bed. Released beds go to `cleaning`, never straight to `available` —
 * a bed is not ready for the next patient until someone has turned it over.
 */
export async function releaseBed({ bedId, user }) {
  if (!bedId) return null;
  return Bed.findByIdAndUpdate(
    bedId,
    {
      status: 'cleaning',
      currentPatientId: null,
      currentEncounterId: null,
      updatedBy: user?._id ?? null,
    },
    { new: true },
  );
}

/**
 * Rebuild which bed the patient occupied over time, from the admission and its
 * transfer history.
 *
 * Returns [{ bedId, wardId, from, to }] covering the whole stay, so each night
 * can be billed at the rate of the bed actually slept in rather than whichever
 * bed the patient happened to end up in.
 */
export function occupancySegments(admission, endAt) {
  if (!admission?.admittedAt) return [];

  const transfers = [...(admission.transfers ?? [])].sort(
    (a, b) => new Date(a.movedAt) - new Date(b.movedAt),
  );

  const segments = [];
  let currentBed = transfers[0]?.fromBedId ?? admission.bedId;
  let currentWard = transfers[0]?.fromWardId ?? admission.wardId;
  let from = new Date(admission.admittedAt);

  for (const move of transfers) {
    segments.push({ bedId: currentBed, wardId: currentWard, from, to: new Date(move.movedAt) });
    currentBed = move.toBedId;
    currentWard = move.toWardId;
    from = new Date(move.movedAt);
  }

  segments.push({ bedId: currentBed, wardId: currentWard, from, to: new Date(endAt) });

  return segments.filter((segment) => segment.bedId && segment.to >= segment.from);
}

/** Which bed the patient was in on a given calendar day. */
function bedOnDay(segments, day) {
  const dayStart = startOfDay(day);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // The segment covering the most of that day wins; ties go to the earlier one.
  let best = null;
  let bestOverlap = -1;

  for (const segment of segments) {
    const overlap =
      Math.min(dayEnd.getTime(), new Date(segment.to).getTime()) -
      Math.max(dayStart.getTime(), new Date(segment.from).getTime());
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = segment;
    }
  }

  return bestOverlap >= 0 ? best : null;
}

/**
 * Raise one bed charge per night of the stay, up to `upTo`.
 *
 * **Policy:** a bed-night is charged per calendar day occupied, counting both
 * the day of admission and the day of discharge. A same-day admission and
 * discharge is therefore one day. Hospitals differ on this — change it here.
 *
 * **Idempotent.** Each line carries `itemCode = BED-<YYYY-MM-DD>` against
 * `sourceType: 'bed'`, `sourceId: encounterId`, so re-running (on discharge,
 * after the nightly job already ran, or by running the job twice) never
 * double-charges. This is what makes it safe to call from both paths.
 */
export async function chargeBedDays({ encounter, upTo = new Date(), user = null }) {
  const admission = encounter.admission;
  if (!admission?.admittedAt) return { charged: 0, skipped: 0, total: 0 };

  const endAt = admission.dischargedAt
    ? new Date(Math.min(new Date(admission.dischargedAt).getTime(), new Date(upTo).getTime()))
    : new Date(upTo);

  if (endAt < new Date(admission.admittedAt)) return { charged: 0, skipped: 0, total: 0 };

  const segments = occupancySegments(admission, endAt);
  const days = daysBetween(admission.admittedAt, endAt);

  // One query, not one per day.
  const existing = await BillingLineItem.find({
    sourceType: 'bed',
    sourceId: encounter._id,
    isActive: true,
  })
    .select('itemCode')
    .lean();
  const alreadyCharged = new Set(existing.map((row) => row.itemCode));

  const bedIds = [...new Set(segments.map((s) => String(s.bedId)))];
  const beds = await Bed.find({ _id: { $in: bedIds } })
    .populate({ path: 'wardId', select: 'name code departmentId' })
    .lean();
  const bedById = new Map(beds.map((bed) => [String(bed._id), bed]));

  const items = [];
  let skipped = 0;

  for (const day of days) {
    const itemCode = `BED-${dayKey(day)}`;
    if (alreadyCharged.has(itemCode)) {
      skipped += 1;
      continue;
    }

    const segment = bedOnDay(segments, day);
    const bed = segment ? bedById.get(String(segment.bedId)) : null;
    if (!bed) continue;

    // A zero-rate bed still gets a line: the stay should be visible on the
    // ledger even where the hospital does not charge for that bed.
    items.push({
      itemCode,
      description: `Bed ${bed.bedNumber}, ${bed.wardId?.name ?? 'ward'} — ${dayKey(day)}`,
      quantity: 1,
      unitPrice: bed.dailyRate ?? 0,
      departmentId: bed.wardId?.departmentId ?? null,
    });
  }

  if (items.length === 0) {
    return { charged: 0, skipped, total: 0 };
  }

  const created = await createCharges({
    patientId: encounter.patientId,
    encounterId: encounter._id,
    sourceType: 'bed',
    sourceId: encounter._id,
    sourceRef: encounter.encounterNumber,
    items,
    user,
  });

  return {
    charged: created.length,
    skipped,
    total: created.reduce((sum, row) => sum + (row.lineTotal ?? 0), 0),
  };
}

export default {
  assertBedAssignable,
  occupyBed,
  releaseBed,
  chargeBedDays,
  occupancySegments,
  daysBetween,
  dayKey,
};
