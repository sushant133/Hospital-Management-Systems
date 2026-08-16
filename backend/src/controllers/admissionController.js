import { Encounter, Bed, Ward, Patient, NursingRound } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, andFilters } from '../utils/queryHelpers.js';
import {
  assertBedAssignable,
  occupyBed,
  releaseBed,
  chargeBedDays,
} from '../services/admissionService.js';

const ADMISSION_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender phone' },
  { path: 'departmentId', select: 'code name' },
  { path: 'attendingDoctorId', select: 'firstName lastName specialization' },
  { path: 'admission.wardId', select: 'code name type gender' },
  { path: 'admission.bedId', select: 'bedNumber dailyRate status' },
];

const ROUND_POPULATE = [
  { path: 'performedBy', select: 'firstName lastName role' },
  { path: 'bedId', select: 'bedNumber' },
  { path: 'wardId', select: 'code name' },
];

/**
 * Admissions: turning a visit into a stay, moving the patient, and ending it.
 *
 * The encounter remains the clinical spine — an admission is a *state* of an
 * encounter, not a separate record — so everything here mutates
 * `encounter.admission` and the bed alongside it.
 */

// ------------------------------------------------------------- admitting ----

/**
 * POST /encounters/:id/admit
 *
 * Gated on `beds.assign`: putting a patient into a bed is the act being
 * controlled, and the matrix already names that.
 */
export const admitPatient = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict(`This visit is ${encounter.status} and cannot be admitted.`, {
      code: 'ENCOUNTER_CLOSED',
    });
  }
  if (encounter.status === 'admitted') {
    throw ApiError.conflict('This patient is already admitted. Use transfer to move them.', {
      code: 'ALREADY_ADMITTED',
      details: { bedId: encounter.admission?.bedId },
    });
  }

  const patient = await Patient.findById(encounter.patientId).select('gender firstName lastName').lean();

  const { bed } = await assertBedAssignable({
    bedId: req.body.bedId,
    wardId: req.body.wardId,
    patient,
  });

  const now = req.body.admittedAt ?? new Date();

  await occupyBed({ bed, patientId: encounter.patientId, encounterId: encounter._id, user: req.user });

  encounter.status = 'admitted';
  // An admitted patient is an inpatient, whatever the visit started as.
  if (encounter.type === 'opd') encounter.type = 'ipd';
  encounter.admission.wardId = bed.wardId;
  encounter.admission.bedId = bed._id;
  encounter.admission.admittedAt = now;
  encounter.admission.admittedBy = req.user._id;
  encounter.admission.admissionReason = req.body.reason ?? encounter.chiefComplaint ?? '';
  encounter.admission.expectedDischargeDate = req.body.expectedDischargeDate ?? null;
  encounter.updatedBy = req.user._id;
  await encounter.save();

  await encounter.populate(ADMISSION_POPULATE);
  return sendResponse(res, {
    message: `Admitted to bed ${bed.bedNumber}`,
    data: encounter,
  });
});

/**
 * POST /encounters/:id/transfer — move an admitted patient to another bed.
 *
 * The move is appended to the transfer history rather than overwriting the
 * placement, so the ward history survives and each night can still be billed at
 * the rate of the bed actually occupied.
 */
export const transferPatient = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (encounter.status !== 'admitted') {
    throw ApiError.conflict('Only an admitted patient can be transferred.', {
      code: 'NOT_ADMITTED',
    });
  }

  const fromBedId = encounter.admission.bedId;
  const fromWardId = encounter.admission.wardId;

  if (String(fromBedId) === String(req.body.bedId)) {
    throw ApiError.badRequest('The patient is already in that bed', {
      details: [{ field: 'bedId', message: 'Choose a different bed' }],
    });
  }

  const patient = await Patient.findById(encounter.patientId).select('gender').lean();

  const { bed } = await assertBedAssignable({
    bedId: req.body.bedId,
    wardId: req.body.wardId,
    patient,
    excludeEncounterId: encounter._id,
  });

  const movedAt = req.body.movedAt ?? new Date();

  await releaseBed({ bedId: fromBedId, user: req.user });
  await occupyBed({ bed, patientId: encounter.patientId, encounterId: encounter._id, user: req.user });

  encounter.admission.transfers.push({
    fromWardId,
    fromBedId,
    toWardId: bed.wardId,
    toBedId: bed._id,
    movedAt,
    movedBy: req.user._id,
    reason: req.body.reason ?? '',
  });
  encounter.admission.wardId = bed.wardId;
  encounter.admission.bedId = bed._id;
  encounter.updatedBy = req.user._id;
  await encounter.save();

  await encounter.populate(ADMISSION_POPULATE);
  return sendResponse(res, {
    message: `Transferred to bed ${bed.bedNumber}`,
    data: encounter,
  });
});

/**
 * POST /encounters/:id/discharge — end an admission.
 *
 * Releases the bed, settles the bed charges for every night of the stay, and
 * requires a discharge summary: an inpatient stay that ends with no written
 * account of it is not a complete record.
 *
 * `POST /encounters/:id/close` remains the path for an OPD visit, which has no
 * bed and no stay to bill.
 */
export const dischargePatient = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (encounter.status !== 'admitted') {
    throw ApiError.conflict(
      'This visit is not an admission. Close it instead.',
      { code: 'NOT_ADMITTED' },
    );
  }

  const now = req.body.dischargedAt ?? new Date();

  encounter.admission.dischargedAt = now;
  encounter.admission.dischargedBy = req.user._id;
  encounter.admission.dischargeSummary = req.body.dischargeSummary;
  encounter.admission.dischargeType = req.body.dischargeType;

  // Bill the stay before the bed is released, while the placement is still known.
  const billing = await chargeBedDays({ encounter, upTo: now, user: req.user });
  encounter.admission.bedChargedThrough = now;

  await releaseBed({ bedId: encounter.admission.bedId, user: req.user });

  encounter.status = 'discharged';
  encounter.endedAt = now;
  encounter.updatedBy = req.user._id;
  await encounter.save();

  await encounter.populate(ADMISSION_POPULATE);
  return sendResponse(res, {
    message: `Discharged — ${billing.charged} bed-night(s) charged`,
    data: encounter,
    meta: { billing },
  });
});

// -------------------------------------------------------------- reading ----

/** GET /admissions — who is currently in a bed. */
export const listAdmissions = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-admission.admittedAt',
  });

  const filter = andFilters(
    { isActive: true },
    // Discharged stays are still admissions; `current` is the ward-board view.
    query.includeDischarged ? { 'admission.admittedAt': { $ne: null } } : { status: 'admitted' },
    query.wardId ? { 'admission.wardId': query.wardId } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.patientId ? { patientId: query.patientId } : null,
  );

  const [admissions, total] = await Promise.all([
    Encounter.find(filter).populate(ADMISSION_POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    Encounter.countDocuments(filter),
  ]);

  const now = new Date();
  const data = admissions.map((row) => ({
    ...row,
    // Length of stay in days, so far or as completed.
    lengthOfStayDays: row.admission?.admittedAt
      ? Math.max(
          1,
          Math.ceil(
            ((row.admission.dischargedAt ? new Date(row.admission.dischargedAt) : now) -
              new Date(row.admission.admittedAt)) /
              86400000,
          ),
        )
      : null,
  }));

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

/**
 * GET /admissions/occupancy — the live bed board.
 *
 * Counts come from the beds themselves rather than from admissions, so a bed
 * left in `cleaning` or `maintenance` is visible as unavailable capacity
 * instead of silently reading as free.
 */
export const getOccupancy = asyncHandler(async (req, res) => {
  const query = getQuery(req);

  const wardFilter = andFilters(
    { isActive: true },
    query.departmentId ? { departmentId: query.departmentId } : null,
  );

  const wards = await Ward.find(wardFilter)
    .populate({ path: 'departmentId', select: 'code name' })
    .sort({ name: 1 })
    .lean();

  const counts = await Bed.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: { wardId: '$wardId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const byWard = new Map();
  for (const row of counts) {
    const key = String(row._id.wardId);
    if (!byWard.has(key)) {
      byWard.set(key, { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, cleaning: 0 });
    }
    const bucket = byWard.get(key);
    bucket[row._id.status] = row.count;
    bucket.total += row.count;
  }

  const wardRows = wards.map((ward) => {
    const bucket = byWard.get(String(ward._id)) ?? {
      total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, cleaning: 0,
    };
    return {
      _id: ward._id,
      code: ward.code,
      name: ward.name,
      type: ward.type,
      gender: ward.gender,
      department: ward.departmentId?.name ?? null,
      ...bucket,
      occupancyRate: bucket.total ? Math.round((bucket.occupied / bucket.total) * 100) : 0,
    };
  });

  const totals = wardRows.reduce(
    (acc, ward) => {
      for (const key of ['total', 'available', 'occupied', 'reserved', 'maintenance', 'cleaning']) {
        acc[key] += ward[key];
      }
      return acc;
    },
    { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, cleaning: 0 },
  );
  totals.occupancyRate = totals.total ? Math.round((totals.occupied / totals.total) * 100) : 0;

  const admittedCount = await Encounter.countDocuments({ status: 'admitted', isActive: true });

  return sendResponse(res, {
    data: wardRows,
    meta: { totals, admittedPatients: admittedCount, asOf: new Date() },
  });
});

// --------------------------------------------------------------- rounds ----

/** POST /encounters/:id/rounds — record a ward round. */
export const recordRound = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (encounter.status !== 'admitted') {
    throw ApiError.conflict('Ward rounds are recorded against an admitted patient.', {
      code: 'NOT_ADMITTED',
    });
  }

  const round = await NursingRound.create({
    ...req.body,
    patientId: encounter.patientId,
    encounterId: encounter._id,
    // Snapshot where the patient was — they may be moved later in the stay.
    wardId: encounter.admission.wardId,
    bedId: encounter.admission.bedId,
    performedBy: req.user._id,
    roundAt: req.body.roundAt ?? new Date(),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await round.populate(ROUND_POPULATE);
  return sendCreated(res, {
    message: round.escalated ? 'Round recorded and escalated' : 'Round recorded',
    data: round,
  });
});

/** GET /encounters/:id/rounds — this stay's rounds, newest first. */
export const listRounds = asyncHandler(async (req, res) => {
  const exists = await Encounter.exists({ _id: req.params.id });
  if (!exists) throw ApiError.notFound('Visit not found');

  const rounds = await NursingRound.find({ encounterId: req.params.id, isActive: true })
    .populate(ROUND_POPULATE)
    .sort({ roundAt: -1 })
    .lean();

  return sendResponse(res, {
    data: rounds,
    meta: { count: rounds.length, escalated: rounds.filter((r) => r.escalated).length },
  });
});
