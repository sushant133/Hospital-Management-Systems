import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  nonEmptyString,
  extendListQuery,
} from '../utils/commonSchemas.js';
import {
  ATTENDANCE_STATUSES,
  SHIFTS,
  PAYROLL_STATUSES,
} from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

/** YYYY-MM. */
const period = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM');

// ------------------------------------------------------------- attendance ----

export const listAttendanceQuery = extendListQuery({
  userId: optionalObjectId,
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  from: optionalDate,
  to: optionalDate,
  unapprovedOnly: booleanFlag,
});

export const ownAttendanceQuery = z.object({
  period: period.optional(),
});

export const clockSchema = z.object({
  /** Both optional — the server uses "now" and "today" by default. */
  at: optionalDate,
  date: optionalDate,
  shift: z.enum(SHIFTS).optional(),
});

export const upsertAttendanceSchema = z.object({
  userId: objectId,
  date: z.coerce.date({ invalid_type_error: 'A valid date is required' }),
  status: z.enum(ATTENDANCE_STATUSES, {
    errorMap: () => ({ message: 'Choose present, absent, leave or half-day' }),
  }),
  shift: z.enum(SHIFTS).optional(),
  checkInAt: optionalDate,
  checkOutAt: optionalDate,
  notes: optionalString(500),
});

export const attendanceSummaryQuery = z.object({
  period: period.optional(),
  departmentId: optionalObjectId,
});

// ------------------------------------------------------ salary structures ----

const componentSchema = z
  .object({
    label: nonEmptyString(80, 'Label'),
    amount: z.coerce.number().min(0).optional().default(0),
    /** Percentage components follow the pro-rated basic — see payrollService. */
    percentOfBasic: z.coerce.number().min(0).max(100).nullable().optional(),
  })
  .refine((v) => v.amount > 0 || (v.percentOfBasic ?? 0) > 0, {
    message: 'Give either an amount or a percentage',
  });

export const listStructuresQuery = extendListQuery({
  userId: optionalObjectId,
  currentOnly: booleanFlag,
});

export const createStructureSchema = z.object({
  userId: objectId,
  basicSalary: z.coerce.number().min(0, 'Basic salary cannot be negative'),
  allowances: z.array(componentSchema).max(20).optional().default([]),
  deductions: z.array(componentSchema).max(20).optional().default([]),
  bankName: optionalString(120),
  bankAccount: optionalString(60),
  effectiveFrom: z.coerce.date({ invalid_type_error: 'An effective date is required' }),
  notes: optionalString(500),
  // `effectiveTo` is set by the server when a later structure supersedes this one.
});

// -------------------------------------------------------------- runs ----

export const listRunsQuery = extendListQuery({
  status: z.enum(PAYROLL_STATUSES).optional(),
});

export const createRunSchema = z.object({
  period,
  /** Defaults to the weekdays in the month. */
  expectedWorkingDays: z.coerce.number().int().min(1).max(31).optional(),
  overtimeMultiplier: z.coerce.number().min(1).max(4).optional(),
  notes: optionalString(500),
});

export const rebuildRunSchema = z.object({
  expectedWorkingDays: z.coerce.number().int().min(1).max(31).optional(),
  overtimeMultiplier: z.coerce.number().min(1).max(4).optional(),
});

export const approveRunSchema = z.object({
  notes: optionalString(500),
});

export const markPaidSchema = z.object({
  paymentReference: optionalString(80),
});

export const cancelRunSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500),
});

// ---------------------------------------------------------------- payslips ----

export const listPayslipsQuery = extendListQuery({
  payrollRunId: optionalObjectId,
  userId: optionalObjectId,
  period: period.optional(),
});
