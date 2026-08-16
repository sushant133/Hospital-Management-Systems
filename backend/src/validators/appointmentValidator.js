import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  dateField,
  extendListQuery,
} from '../utils/commonSchemas.js';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  DAYS_OF_WEEK,
  TIME_PATTERN,
} from '../models/index.js';

/**
 * Reasons are mandatory wherever a booking is taken away from a patient
 * (cancel, reschedule). "Reason capture" is a Phase 2 requirement, and a free
 * -text box nobody fills in is not capture — hence the minimum length.
 */
const requiredReason = z
  .string()
  .trim()
  .min(5, 'Give a reason of at least 5 characters')
  .max(500, 'Reason must be 500 characters or fewer');

const timeString = z.string().trim().regex(TIME_PATTERN, 'Time must be HH:MM on a 24-hour clock');

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

// ------------------------------------------------------------- queries ----

export const listAppointmentsQuery = extendListQuery({
  patientId: optionalObjectId,
  doctorId: optionalObjectId,
  departmentId: optionalObjectId,
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  type: z.enum(APPOINTMENT_TYPES).optional(),
  from: optionalDate,
  to: optionalDate,
  isWalkIn: booleanFlag,
  /** Everything still holding a slot — the desk's default view. */
  upcomingOnly: booleanFlag,
});

/** GET /appointments/slots — a doctor's grid for one day. */
export const slotsQuery = z.object({
  doctorId: objectId,
  date: dateField,
});

/** GET /appointments/schedule — a day, by doctor or by department. */
export const scheduleQuery = z
  .object({
    date: dateField,
    doctorId: optionalObjectId,
    departmentId: optionalObjectId,
  })
  .refine((v) => v.doctorId || v.departmentId, {
    message: 'Name a doctor or a department',
    path: ['doctorId'],
  });

/** GET /appointments/queue — today's walk-in board. */
export const queueQuery = z.object({
  date: optionalDate,
  departmentId: optionalObjectId,
});

// -------------------------------------------------------------- writes ----

export const createAppointmentSchema = z.object({
  patientId: objectId,
  doctorId: objectId,
  /** Optional — defaults to the doctor's department when omitted. */
  departmentId: optionalObjectId,
  scheduledStart: dateField,
  /** Optional — defaults to the slot length published for that time. */
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  type: z.enum(APPOINTMENT_TYPES).default('consultation'),
  reason: optionalString(500),
  notes: optionalString(1000),
});

/**
 * Walk-ins have no slot: they arrive, take a queue number for the department
 * and are seen in order. A doctor may be named at the desk or left for triage.
 */
export const createWalkInSchema = z.object({
  patientId: objectId,
  departmentId: objectId,
  doctorId: optionalObjectId,
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  type: z.enum(APPOINTMENT_TYPES).default('consultation'),
  reason: optionalString(500),
  notes: optionalString(1000),
});

/** Details only. Moving an appointment in time goes through /reschedule. */
export const updateAppointmentSchema = z
  .object({
    type: z.enum(APPOINTMENT_TYPES).optional(),
    reason: optionalString(500),
    notes: optionalString(1000),
    doctorId: optionalObjectId,
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined && field !== null), {
    message: 'Nothing to update',
  });

export const rescheduleSchema = z.object({
  scheduledStart: dateField,
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  /** Moving the patient to a different doctor is a legitimate reschedule. */
  doctorId: optionalObjectId,
  reason: requiredReason,
});

export const cancelAppointmentSchema = z.object({
  reason: requiredReason,
});

export const noShowSchema = z.object({
  notes: optionalString(500),
});

/**
 * Check-in opens the encounter the rest of the clinical record hangs off, so it
 * accepts the few fields an encounter needs that a booking does not carry.
 */
export const checkInSchema = z.object({
  encounterType: z.enum(['opd', 'ipd', 'emergency', 'daycare']).default('opd'),
  chiefComplaint: optionalString(500),
});

// -------------------------------------------------------- availability ----

export const availabilityQuery = z.object({
  doctorId: optionalObjectId,
  departmentId: optionalObjectId,
  includeInactive: booleanFlag,
});

export const createAvailabilitySchema = z.object({
  doctorId: objectId,
  departmentId: optionalObjectId,
  dayOfWeek: z.coerce
    .number()
    .int()
    .refine((v) => DAYS_OF_WEEK.includes(v), { message: 'Day must be 0 (Sunday) to 6 (Saturday)' }),
  startTime: timeString,
  endTime: timeString,
  slotMinutes: z.coerce.number().int().min(5).max(240).default(15),
  slotCapacity: z.coerce.number().int().min(1).max(10).default(1),
  effectiveFrom: optionalDate,
  effectiveTo: optionalDate,
  notes: optionalString(300),
});

export const updateAvailabilitySchema = createAvailabilitySchema
  .partial()
  .omit({ doctorId: true })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
