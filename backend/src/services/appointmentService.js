import {
  Appointment,
  Attendance,
  DoctorAvailability,
  ACTIVE_APPOINTMENT_STATUSES,
  toMinutes,
  toTimeString,
} from '../models/index.js';
import { nextSequence } from '../utils/sequence.js';
import ApiError from '../utils/ApiError.js';

/**
 * Scheduling logic, kept out of the controller so the slot maths is testable on
 * its own and so booking, rescheduling and the walk-in desk all agree on what
 * "free" means.
 *
 * Everything here works in the server's local timezone. Availability is stored
 * as wall-clock strings ("Monday 09:00"), so a slot is only an instant once it
 * is anchored to a calendar date — which is what buildSlotDate does.
 */

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Anchor 'HH:MM' to a calendar date, in local time. */
function buildSlotDate(date, minutesFromMidnight) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutesFromMidnight);
  return d;
}

/** YYYY-MM-DD in local time — the key half of a per-day counter. */
export function dateKey(date) {
  const d = new Date(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Appointments that still hold their slot and overlap [start, end).
 *
 * Overlap is `existing.start < end && existing.end > start` — touching
 * boundaries do not collide, so a 09:15 appointment may follow a 09:00–09:15 one.
 */
export async function findOverlapping({ doctorId, start, end, excludeId = null }) {
  if (!doctorId) return [];

  const filter = {
    doctorId,
    isActive: true,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
    scheduledStart: { $lt: end },
    scheduledEnd: { $gt: start },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  return Appointment.find(filter)
    .select('appointmentNumber scheduledStart scheduledEnd status patientId')
    .lean();
}

/**
 * Capacity for a doctor at an instant, taken from the availability window that
 * covers it. Returns 1 when no window matches — a booking made outside
 * published hours (which reception may do deliberately) still blocks its slot.
 */
async function capacityAt(doctorId, start) {
  const windows = await DoctorAvailability.find({
    doctorId,
    dayOfWeek: start.getDay(),
    isActive: true,
  }).lean();

  const minutes = start.getHours() * 60 + start.getMinutes();
  const match = windows.find(
    (w) =>
      minutes >= toMinutes(w.startTime) &&
      minutes < toMinutes(w.endTime) &&
      withinEffective(w, start),
  );

  return match?.slotCapacity ?? 1;
}

function withinEffective(window, date) {
  if (window.effectiveFrom && date < startOfDay(window.effectiveFrom)) return false;
  if (window.effectiveTo && date > endOfDay(window.effectiveTo)) return false;
  return true;
}

/**
 * Refuse a booking that would exceed the slot's capacity.
 *
 * This is the only guard against double-booking. It is a read-then-write check,
 * so two simultaneous bookings for the last free slot can both pass — the
 * window is milliseconds wide and the desk sees the result immediately, which
 * is the same trade-off the lab's status transitions make. A unique index
 * cannot express "capacity N", so hardening this further means a transaction.
 */
export async function doctorOnLeave(doctorId, date) {
  if (!doctorId) return false;
  const day = startOfDay(date);
  const record = await Attendance.findOne({
    userId: doctorId,
    date: day,
    status: 'leave',
    isActive: true,
  })
    .select('_id')
    .lean();
  return Boolean(record);
}

export async function assertSlotAvailable({ doctorId, start, end, excludeId = null }) {
  if (!doctorId) return;

  if (await doctorOnLeave(doctorId, start)) {
    throw ApiError.conflict('This doctor is on leave that day — no slots can be booked.', {
      code: 'DOCTOR_ON_LEAVE',
    });
  }

  const [overlapping, capacity] = await Promise.all([
    findOverlapping({ doctorId, start, end, excludeId }),
    capacityAt(doctorId, start),
  ]);

  if (overlapping.length >= capacity) {
    throw ApiError.conflict(
      capacity === 1
        ? 'That slot is already booked for this doctor.'
        : `That slot is full (${overlapping.length}/${capacity} booked).`,
      {
        code: 'SLOT_UNAVAILABLE',
        details: {
          capacity,
          booked: overlapping.length,
          conflicts: overlapping.map((a) => ({
            appointmentNumber: a.appointmentNumber,
            scheduledStart: a.scheduledStart,
            scheduledEnd: a.scheduledEnd,
          })),
        },
      },
    );
  }
}

/**
 * Every slot a doctor has on a date, each marked free or taken.
 *
 * Returns the whole grid rather than only free slots, so the booking UI can
 * show a full day with the taken slots visibly disabled.
 */
export async function generateSlots({ doctorId, date, now = new Date() }) {
  const day = startOfDay(date);

  const windows = await DoctorAvailability.find({
    doctorId,
    dayOfWeek: day.getDay(),
    isActive: true,
  })
    .populate({ path: 'departmentId', select: 'code name' })
    .lean();

  const applicable = windows.filter((w) => withinEffective(w, day));
  if (applicable.length === 0) return [];

  if (await doctorOnLeave(doctorId, day)) {
    return [
      {
        start: day,
        end: endOfDay(day),
        time: '00:00',
        durationMinutes: 0,
        departmentId: applicable[0]?.departmentId?._id ?? applicable[0]?.departmentId,
        department: applicable[0]?.departmentId?.name,
        capacity: 0,
        booked: 0,
        isPast: true,
        available: false,
        blockedReason: 'on-leave',
      },
    ];
  }

  // One query for the whole day beats one per slot.
  const booked = await Appointment.find({
    doctorId,
    isActive: true,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
    scheduledStart: { $gte: day, $lte: endOfDay(day) },
  })
    .select('scheduledStart scheduledEnd')
    .lean();

  const slots = [];

  for (const window of applicable) {
    const from = toMinutes(window.startTime);
    const to = toMinutes(window.endTime);

    for (let cursor = from; cursor + window.slotMinutes <= to; cursor += window.slotMinutes) {
      const start = buildSlotDate(day, cursor);
      const end = buildSlotDate(day, cursor + window.slotMinutes);

      const taken = booked.filter(
        (a) => a.scheduledStart < end && a.scheduledEnd > start,
      ).length;

      slots.push({
        start,
        end,
        time: toTimeString(cursor),
        durationMinutes: window.slotMinutes,
        departmentId: window.departmentId?._id ?? window.departmentId,
        department: window.departmentId?.name,
        capacity: window.slotCapacity,
        booked: taken,
        isPast: end <= now,
        available: taken < window.slotCapacity && end > now,
      });
    }
  }

  // Windows are independent rows, so a split clinic needs sorting into one day.
  return slots.sort((a, b) => a.start - b.start);
}

/**
 * Next queue number for a department on a date.
 *
 * Counters are per department per day (`walkIn:<dept>:<YYYY-MM-DD>`), so each
 * desk starts at 1 every morning and two departments never share a number.
 */
export async function allocateQueueNumber(departmentId, date = new Date()) {
  return nextSequence(`walkIn:${departmentId}:${dateKey(date)}`);
}

export default {
  generateSlots,
  assertSlotAvailable,
  findOverlapping,
  allocateQueueNumber,
  startOfDay,
  endOfDay,
  dateKey,
};
