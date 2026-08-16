import {
  Appointment,
  DoctorAvailability,
  Patient,
  Department,
  Encounter,
  User,
  APPOINTMENT_TRANSITIONS,
  ACTIVE_APPOINTMENT_STATUSES,
  DAY_LABELS,
} from '../models/index.js';
import { ROLES } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';
import {
  generateSlots,
  assertSlotAvailable,
  allocateQueueNumber,
  startOfDay,
  endOfDay,
} from '../services/appointmentService.js';

const POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender phone' },
  { path: 'doctorId', select: 'firstName lastName specialization role' },
  { path: 'departmentId', select: 'code name' },
  { path: 'encounterId', select: 'encounterNumber type status' },
  { path: 'checkedInBy', select: 'firstName lastName role' },
];

const DEFAULT_DURATION = 15;

/** Reject any status change that isn't a legal forward transition. */
function assertTransition(from, to) {
  const allowed = APPOINTMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `Cannot move an appointment from "${from}" to "${to}".` +
        (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This appointment is final.'),
      { code: 'INVALID_STATUS_TRANSITION' },
    );
  }
}

async function assertDoctor(userId) {
  const doctor = await User.findOne({
    _id: userId,
    isActive: true,
    role: { $in: [ROLES.DOCTOR, ROLES.ADMIN] },
  }).lean();

  if (!doctor) {
    throw ApiError.badRequest('The selected doctor is not a valid active doctor', {
      details: [{ field: 'doctorId', message: 'Invalid doctor' }],
    });
  }
  return doctor;
}

async function assertPatient(patientId) {
  const patient = await Patient.findOne({ _id: patientId, isActive: true }).lean();
  if (!patient) {
    throw ApiError.badRequest('The selected patient does not exist or is inactive', {
      details: [{ field: 'patientId', message: 'Invalid patient' }],
    });
  }
  return patient;
}

async function assertDepartment(departmentId) {
  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
  if (!department) {
    throw ApiError.badRequest('The selected department does not exist or is inactive', {
      details: [{ field: 'departmentId', message: 'Invalid department' }],
    });
  }
  return department;
}

/**
 * Slot length to use when the caller doesn't specify one: whatever the doctor
 * publishes for that time of day, falling back to 15 minutes.
 */
async function resolveDuration(doctorId, start, requested) {
  if (requested) return requested;

  const windows = await DoctorAvailability.find({
    doctorId,
    dayOfWeek: start.getDay(),
    isActive: true,
  })
    .select('startTime endTime slotMinutes')
    .lean();

  const minutes = start.getHours() * 60 + start.getMinutes();
  const match = windows.find((w) => {
    const [sh, sm] = w.startTime.split(':').map(Number);
    const [eh, em] = w.endTime.split(':').map(Number);
    return minutes >= sh * 60 + sm && minutes < eh * 60 + em;
  });

  return match?.slotMinutes ?? DEFAULT_DURATION;
}

// ------------------------------------------------------------- listing ----

/** GET /appointments */
export const listAppointments = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || 'scheduledStart',
  });

  const dateRange = {};
  if (query.from) dateRange.$gte = startOfDay(query.from);
  if (query.to) dateRange.$lte = endOfDay(query.to);

  const filters = [
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.doctorId ? { doctorId: query.doctorId } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.status ? { status: query.status } : null,
    query.type ? { type: query.type } : null,
    query.isWalkIn ? { isWalkIn: true } : null,
    query.upcomingOnly ? { status: { $in: ACTIVE_APPOINTMENT_STATUSES } } : null,
    Object.keys(dateRange).length ? { scheduledStart: dateRange } : null,
  ];

  const filter = andFilters(...filters);

  const [appointments, total] = await Promise.all([
    Appointment.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    Appointment.countDocuments(filter),
  ]);

  return sendResponse(res, {
    data: appointments,
    meta: buildMeta({ page, limit, total }),
  });
});

/** GET /appointments/:id */
export const getAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id).populate(POPULATE).lean();
  if (!appointment) throw ApiError.notFound('Appointment not found');
  return sendResponse(res, { data: appointment });
});

/**
 * GET /appointments/slots — the bookable grid for one doctor on one day.
 * Drives the booking form; taken slots are returned too, marked unavailable.
 */
export const listSlots = asyncHandler(async (req, res) => {
  const { doctorId, date } = getQuery(req);
  await assertDoctor(doctorId);

  const slots = await generateSlots({ doctorId, date });

  return sendResponse(res, {
    data: slots,
    meta: {
      date: startOfDay(date),
      dayOfWeek: DAY_LABELS[startOfDay(date).getDay()],
      total: slots.length,
      available: slots.filter((s) => s.available).length,
    },
  });
});

/**
 * GET /appointments/schedule — a day's list for a doctor or a whole department.
 * Unlike /slots this shows what is booked, not what is bookable.
 */
export const getDaySchedule = asyncHandler(async (req, res) => {
  const { date, doctorId, departmentId } = getQuery(req);

  const filter = {
    isActive: true,
    scheduledStart: { $gte: startOfDay(date), $lte: endOfDay(date) },
  };
  if (doctorId) filter.doctorId = doctorId;
  if (departmentId) filter.departmentId = departmentId;

  const appointments = await Appointment.find(filter)
    .populate(POPULATE)
    .sort({ scheduledStart: 1, queueNumber: 1 })
    .lean();

  const counts = appointments.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return sendResponse(res, {
    data: appointments,
    meta: {
      date: startOfDay(date),
      total: appointments.length,
      byStatus: counts,
      walkIns: appointments.filter((a) => a.isWalkIn).length,
    },
  });
});

/** GET /appointments/queue — today's walk-in board, in arrival order. */
export const getWalkInQueue = asyncHandler(async (req, res) => {
  const { date, departmentId } = getQuery(req);
  const day = date ?? new Date();

  const filter = {
    isActive: true,
    isWalkIn: true,
    scheduledStart: { $gte: startOfDay(day), $lte: endOfDay(day) },
  };
  if (departmentId) filter.departmentId = departmentId;

  const queue = await Appointment.find(filter)
    .populate(POPULATE)
    .sort({ queueNumber: 1 })
    .lean();

  return sendResponse(res, {
    data: queue,
    meta: {
      date: startOfDay(day),
      waiting: queue.filter((a) => a.status === 'scheduled').length,
      inProgress: queue.filter((a) => a.status === 'checked-in').length,
      done: queue.filter((a) => a.status === 'completed').length,
    },
  });
});

// -------------------------------------------------------------- booking ----

/** POST /appointments — book a slot. */
export const createAppointment = asyncHandler(async (req, res) => {
  const { patientId, doctorId, departmentId, scheduledStart, durationMinutes, ...rest } = req.body;

  await assertPatient(patientId);
  const doctor = await assertDoctor(doctorId);

  // Falls back to the doctor's own department so the desk need not restate it.
  const resolvedDepartmentId = departmentId ?? doctor.departmentId;
  if (!resolvedDepartmentId) {
    throw ApiError.badRequest('This doctor has no department — name one explicitly', {
      details: [{ field: 'departmentId', message: 'Department is required' }],
    });
  }
  await assertDepartment(resolvedDepartmentId);

  if (scheduledStart < new Date()) {
    throw ApiError.badRequest('Appointments cannot be booked in the past', {
      details: [{ field: 'scheduledStart', message: 'Choose a future time' }],
    });
  }

  const duration = await resolveDuration(doctorId, scheduledStart, durationMinutes);
  const end = new Date(scheduledStart.getTime() + duration * 60000);

  await assertSlotAvailable({ doctorId, start: scheduledStart, end });

  const appointment = await Appointment.create({
    ...rest,
    patientId,
    doctorId,
    departmentId: resolvedDepartmentId,
    scheduledStart,
    durationMinutes: duration,
    status: 'scheduled',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await appointment.populate(POPULATE);

  if (doctorId) {
    const { notify } = await import('../services/notificationService.js');
    void notify({
      userId: doctorId,
      type: 'appointment',
      title: `New booking ${appointment.appointmentNumber}`,
      body: `A patient has been booked at ${appointment.scheduledStart.toISOString()}`,
      patientId,
      resourceType: 'Appointment',
      resourceId: appointment._id,
    });
  }

  return sendCreated(res, { message: 'Appointment booked', data: appointment });
});

/**
 * POST /appointments/walk-in — register an arrival and issue a queue number.
 *
 * Walk-ins are appointments with `isWalkIn` and a queue number instead of a
 * chosen slot, so the desk, the day schedule and check-in all work on one
 * collection rather than two parallel ones.
 */
export const createWalkIn = asyncHandler(async (req, res) => {
  const { patientId, departmentId, doctorId, durationMinutes, ...rest } = req.body;

  await assertPatient(patientId);
  await assertDepartment(departmentId);
  if (doctorId) await assertDoctor(doctorId);

  const now = new Date();
  const queueNumber = await allocateQueueNumber(departmentId, now);

  const appointment = await Appointment.create({
    ...rest,
    patientId,
    doctorId: doctorId ?? null,
    departmentId,
    // Arrival time is the walk-in's "slot" — the queue, not the clock, orders them.
    scheduledStart: now,
    durationMinutes: durationMinutes ?? DEFAULT_DURATION,
    isWalkIn: true,
    queueNumber,
    status: 'scheduled',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await appointment.populate(POPULATE);
  return sendCreated(res, {
    message: `Added to the queue as #${queueNumber}`,
    data: appointment,
  });
});

/** PATCH /appointments/:id — details only; time changes go through /reschedule. */
export const updateAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw ApiError.notFound('Appointment not found');

  if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)) {
    throw ApiError.conflict(`A ${appointment.status} appointment can no longer be edited`, {
      code: 'APPOINTMENT_CLOSED',
    });
  }

  const { doctorId, ...rest } = req.body;

  // Reassigning the doctor has to clear the new doctor's slot, not the old one's.
  if (doctorId !== undefined && doctorId !== null && String(doctorId) !== String(appointment.doctorId)) {
    await assertDoctor(doctorId);
    await assertSlotAvailable({
      doctorId,
      start: appointment.scheduledStart,
      end: appointment.scheduledEnd,
      excludeId: appointment._id,
    });
    appointment.doctorId = doctorId;
  }

  Object.assign(appointment, rest);
  appointment.updatedBy = req.user._id;
  await appointment.save();

  await appointment.populate(POPULATE);
  return sendResponse(res, { message: 'Appointment updated', data: appointment });
});

/**
 * POST /appointments/:id/reschedule
 *
 * Closes the original as `rescheduled` and creates a new booking linked to it,
 * rather than moving the existing row. The old slot, and the reason it was
 * given up, stay on the record.
 */
export const rescheduleAppointment = asyncHandler(async (req, res) => {
  const original = await Appointment.findById(req.params.id);
  if (!original) throw ApiError.notFound('Appointment not found');

  assertTransition(original.status, 'rescheduled');

  const { scheduledStart, durationMinutes, doctorId, reason } = req.body;

  const targetDoctorId = doctorId ?? original.doctorId;
  if (!targetDoctorId) {
    throw ApiError.badRequest('Name the doctor for the new appointment', {
      details: [{ field: 'doctorId', message: 'Doctor is required' }],
    });
  }
  if (doctorId) await assertDoctor(doctorId);

  if (scheduledStart < new Date()) {
    throw ApiError.badRequest('The new time is in the past', {
      details: [{ field: 'scheduledStart', message: 'Choose a future time' }],
    });
  }

  const duration = await resolveDuration(
    targetDoctorId,
    scheduledStart,
    durationMinutes ?? original.durationMinutes,
  );
  const end = new Date(scheduledStart.getTime() + duration * 60000);

  await assertSlotAvailable({
    doctorId: targetDoctorId,
    start: scheduledStart,
    end,
    excludeId: original._id,
  });

  const replacement = await Appointment.create({
    patientId: original.patientId,
    doctorId: targetDoctorId,
    departmentId: original.departmentId,
    type: original.type,
    reason: original.reason,
    notes: original.notes,
    scheduledStart,
    durationMinutes: duration,
    status: 'scheduled',
    rescheduledFrom: original._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  original.status = 'rescheduled';
  original.rescheduledTo = replacement._id;
  original.rescheduleReason = reason;
  original.updatedBy = req.user._id;
  await original.save();

  await replacement.populate(POPULATE);
  return sendCreated(res, {
    message: `Rescheduled — new appointment ${replacement.appointmentNumber}`,
    data: replacement,
  });
});

/** POST /appointments/:id/cancel — reason is mandatory. */
export const cancelAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw ApiError.notFound('Appointment not found');

  assertTransition(appointment.status, 'cancelled');

  appointment.status = 'cancelled';
  appointment.cancelledAt = new Date();
  appointment.cancelledBy = req.user._id;
  appointment.cancellationReason = req.body.reason;
  appointment.updatedBy = req.user._id;
  await appointment.save();

  await appointment.populate(POPULATE);
  return sendResponse(res, { message: 'Appointment cancelled', data: appointment });
});

/** POST /appointments/:id/no-show — the patient never arrived. */
export const markNoShow = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw ApiError.notFound('Appointment not found');

  assertTransition(appointment.status, 'no-show');

  // Guards against marking someone absent from a slot that hasn't happened yet.
  if (appointment.scheduledStart > new Date()) {
    throw ApiError.badRequest('This appointment has not started yet', {
      code: 'APPOINTMENT_NOT_DUE',
    });
  }

  appointment.status = 'no-show';
  appointment.noShowAt = new Date();
  appointment.noShowBy = req.user._id;
  if (req.body.notes) appointment.notes = req.body.notes;
  appointment.updatedBy = req.user._id;
  await appointment.save();

  await appointment.populate(POPULATE);
  return sendResponse(res, { message: 'Marked as no-show', data: appointment });
});

/**
 * POST /appointments/:id/check-in — the hand-off from scheduling into the
 * clinical record. Opens an encounter and links it to the booking.
 *
 * A patient who already has an open visit is attached to it rather than
 * rejected: the front desk should never be blocked because someone opened the
 * encounter a moment earlier.
 */
export const checkIn = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw ApiError.notFound('Appointment not found');

  assertTransition(appointment.status, 'checked-in');

  const existing = await Encounter.findOne({
    patientId: appointment.patientId,
    status: { $in: ['open', 'admitted'] },
    isActive: true,
  });

  let encounter = existing;

  if (!encounter) {
    encounter = await Encounter.create({
      patientId: appointment.patientId,
      departmentId: appointment.departmentId,
      attendingDoctorId: appointment.doctorId ?? null,
      type: req.body.encounterType ?? 'opd',
      chiefComplaint: req.body.chiefComplaint ?? appointment.reason ?? '',
      status: 'open',
      startedAt: new Date(),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  }

  appointment.status = 'checked-in';
  appointment.checkedInAt = new Date();
  appointment.checkedInBy = req.user._id;
  appointment.encounterId = encounter._id;
  appointment.updatedBy = req.user._id;
  await appointment.save();

  await appointment.populate(POPULATE);
  return sendResponse(res, {
    message: existing
      ? `Checked in against the patient's open visit ${encounter.encounterNumber}`
      : `Checked in — visit ${encounter.encounterNumber} opened`,
    data: appointment,
  });
});

/** POST /appointments/:id/complete — the consultation is finished. */
export const completeAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw ApiError.notFound('Appointment not found');

  assertTransition(appointment.status, 'completed');

  appointment.status = 'completed';
  appointment.completedAt = new Date();
  appointment.updatedBy = req.user._id;
  await appointment.save();

  await appointment.populate(POPULATE);
  return sendResponse(res, { message: 'Appointment completed', data: appointment });
});

/** DELETE /appointments/:id — soft delete. */
export const deleteAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw ApiError.notFound('Appointment not found');

  Object.assign(appointment, softDeletePatch(req.user));
  await appointment.save();

  return sendResponse(res, { message: 'Appointment removed', data: { _id: appointment._id } });
});

// -------------------------------------------------------- availability ----

/** GET /appointments/availability */
export const listAvailability = asyncHandler(async (req, res) => {
  const query = getQuery(req);

  const filter = andFilters(
    activeScope(query, req.user),
    query.doctorId ? { doctorId: query.doctorId } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
  );

  const windows = await DoctorAvailability.find(filter)
    .populate([
      { path: 'doctorId', select: 'firstName lastName specialization' },
      { path: 'departmentId', select: 'code name' },
    ])
    .sort({ dayOfWeek: 1, startTime: 1 })
    .lean();

  return sendResponse(res, {
    data: windows.map((w) => ({ ...w, dayLabel: DAY_LABELS[w.dayOfWeek] })),
  });
});

/** POST /appointments/availability — publish a weekly clinic window. */
export const createAvailability = asyncHandler(async (req, res) => {
  const { doctorId, departmentId, ...rest } = req.body;

  const doctor = await assertDoctor(doctorId);

  const resolvedDepartmentId = departmentId ?? doctor.departmentId;
  if (!resolvedDepartmentId) {
    throw ApiError.badRequest('This doctor has no department — name one explicitly', {
      details: [{ field: 'departmentId', message: 'Department is required' }],
    });
  }
  await assertDepartment(resolvedDepartmentId);

  // Two windows on the same day that overlap would generate duplicate slots.
  await assertNoWindowOverlap({
    doctorId,
    dayOfWeek: rest.dayOfWeek,
    startTime: rest.startTime,
    endTime: rest.endTime,
  });

  const window = await DoctorAvailability.create({
    ...rest,
    doctorId,
    departmentId: resolvedDepartmentId,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, { message: 'Availability published', data: window });
});

/** PATCH /appointments/availability/:id */
export const updateAvailability = asyncHandler(async (req, res) => {
  const window = await DoctorAvailability.findById(req.params.id);
  if (!window) throw ApiError.notFound('Availability window not found');

  const next = { ...window.toObject(), ...req.body };

  await assertNoWindowOverlap({
    doctorId: window.doctorId,
    dayOfWeek: next.dayOfWeek,
    startTime: next.startTime,
    endTime: next.endTime,
    excludeId: window._id,
  });

  if (req.body.departmentId) await assertDepartment(req.body.departmentId);

  Object.assign(window, req.body);
  window.updatedBy = req.user._id;
  await window.save();

  return sendResponse(res, { message: 'Availability updated', data: window });
});

/** DELETE /appointments/availability/:id — soft delete; booked slots survive. */
export const deleteAvailability = asyncHandler(async (req, res) => {
  const window = await DoctorAvailability.findById(req.params.id);
  if (!window) throw ApiError.notFound('Availability window not found');

  Object.assign(window, softDeletePatch(req.user));
  await window.save();

  return sendResponse(res, { message: 'Availability removed', data: { _id: window._id } });
});

/** Overlapping windows on the same weekday would double-generate slots. */
async function assertNoWindowOverlap({ doctorId, dayOfWeek, startTime, endTime, excludeId = null }) {
  const filter = { doctorId, dayOfWeek, isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };

  const existing = await DoctorAvailability.find(filter).select('startTime endTime').lean();

  const clash = existing.find((w) => w.startTime < endTime && w.endTime > startTime);
  if (clash) {
    throw ApiError.conflict(
      `This overlaps an existing ${DAY_LABELS[dayOfWeek]} window (${clash.startTime}–${clash.endTime})`,
      { code: 'AVAILABILITY_OVERLAP' },
    );
  }
}
