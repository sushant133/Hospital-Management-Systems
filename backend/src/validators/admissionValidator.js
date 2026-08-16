import { z } from 'zod';
import { objectId, optionalObjectId, optionalString, optionalDate } from '../utils/commonSchemas.js';
import { MOBILITY_LEVELS, CONSCIOUSNESS_LEVELS, RISK_LEVELS } from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

export const admitSchema = z.object({
  bedId: objectId,
  /** Optional — the bed already knows its ward; naming it is a cross-check. */
  wardId: optionalObjectId,
  reason: optionalString(500),
  expectedDischargeDate: optionalDate,
  admittedAt: optionalDate,
});

export const transferSchema = z.object({
  bedId: objectId,
  wardId: optionalObjectId,
  /**
   * Required. A patient moved between wards without a stated reason is the
   * kind of gap that makes an incident review impossible.
   */
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500, 'Reason must be 500 characters or fewer'),
  movedAt: optionalDate,
});

export const dischargeSchema = z.object({
  /** An inpatient stay that ends with no written account of it is incomplete. */
  dischargeSummary: z
    .string()
    .trim()
    .min(20, 'A discharge summary of at least 20 characters is required')
    .max(8000, 'Discharge summary must be 8000 characters or fewer'),
  dischargeType: z.enum(['recovered', 'referred', 'lama', 'transferred', 'deceased'], {
    errorMap: () => ({ message: 'Select a discharge outcome' }),
  }),
  dischargedAt: optionalDate,
});

export const listAdmissionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().trim().optional(),
  wardId: optionalObjectId,
  departmentId: optionalObjectId,
  patientId: optionalObjectId,
  includeDischarged: booleanFlag,
});

export const occupancyQuery = z.object({
  departmentId: optionalObjectId,
});

export const recordRoundSchema = z
  .object({
    roundAt: optionalDate,
    consciousness: z.enum(CONSCIOUSNESS_LEVELS).optional(),
    mobility: z.enum(MOBILITY_LEVELS).optional(),
    painScore: z.coerce.number().int().min(0).max(10).optional(),

    repositioned: z.coerce.boolean().optional(),
    pressureAreasChecked: z.coerce.boolean().optional(),
    hygieneAssisted: z.coerce.boolean().optional(),
    medicationGiven: z.coerce.boolean().optional(),
    ivLineChecked: z.coerce.boolean().optional(),
    catheterChecked: z.coerce.boolean().optional(),

    intakeMl: z.coerce.number().min(0).max(20000).optional(),
    outputMl: z.coerce.number().min(0).max(20000).optional(),

    fallRisk: z.enum(RISK_LEVELS).optional(),
    escalated: z.coerce.boolean().optional(),
    escalationReason: optionalString(500),
    notes: optionalString(2000),
  })
  .refine((v) => !v.escalated || (v.escalationReason ?? '').trim().length >= 5, {
    message: 'Say why the round is being escalated',
    path: ['escalationReason'],
  });
