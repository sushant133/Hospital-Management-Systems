import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  optionalEmail,
  nonEmptyString,
  extendListQuery,
} from '../utils/commonSchemas.js';
import {
  POLICY_STATUSES,
  RELATIONSHIPS,
  PREAUTH_STATUSES,
  CLAIM_STATUSES,
} from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code is too short')
  .max(24, 'Code is too long')
  .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only');

// ------------------------------------------------------------- providers ----

export const listProvidersQuery = extendListQuery({
  kind: z.enum(['insurer', 'tpa']).optional(),
});

export const createProviderSchema = z.object({
  code,
  name: nonEmptyString(160, 'Provider name'),
  kind: z.enum(['insurer', 'tpa']).optional().default('insurer'),
  contactPerson: optionalString(120),
  phone: optionalString(30),
  email: optionalEmail,
  address: optionalString(400),
  claimSubmissionEmail: optionalEmail,
  defaultCoPayPercent: z.coerce.number().min(0).max(100).optional().default(20),
  settlementDays: z.coerce.number().int().min(0).max(365).optional().default(30),
  /** Matched against charge descriptions when a claim is built. */
  exclusions: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
  notes: optionalString(1000),
});

export const updateProviderSchema = createProviderSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

// -------------------------------------------------------------- policies ----

export const listPoliciesQuery = extendListQuery({
  patientId: optionalObjectId,
  providerId: optionalObjectId,
  status: z.enum(POLICY_STATUSES).optional(),
});

export const createPolicySchema = z.object({
  patientId: objectId,
  providerId: objectId,
  policyNumber: nonEmptyString(60, 'Policy number'),
  planName: optionalString(120),
  memberName: optionalString(160),
  relationshipToMember: z.enum(RELATIONSHIPS).optional().default('self'),
  /** Null means "use the insurer's default", so it is stored rather than copied. */
  coPayPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  coverageLimit: z.coerce.number().min(0).optional().default(0),
  validFrom: z.coerce.date({ invalid_type_error: 'A valid start date is required' }),
  validTill: z.coerce.date({ invalid_type_error: 'A valid expiry date is required' }),
  status: z.enum(POLICY_STATUSES).optional().default('active'),
  notes: optionalString(1000),
  // `coverageUsed` is deliberately absent — it moves when a claim is approved.
});

export const updatePolicySchema = createPolicySchema
  .partial()
  .omit({ patientId: true, providerId: true })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const verifyPolicySchema = z.object({
  /** Lets the check also correct the status, e.g. marking a lapsed policy expired. */
  status: z.enum(POLICY_STATUSES).optional(),
  notes: optionalString(1000),
});

// ------------------------------------------------------ pre-authorisation ----

export const listPreAuthsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  policyId: optionalObjectId,
  status: z.enum(PREAUTH_STATUSES).optional(),
});

export const createPreAuthSchema = z.object({
  policyId: objectId,
  encounterId: objectId,
  requestedServices: z
    .array(
      z.object({
        description: nonEmptyString(240, 'Service description'),
        estimatedAmount: z.coerce.number().min(0),
      }),
    )
    .min(1, 'List at least one service')
    .max(50),
  clinicalJustification: optionalString(2000),
});

export const preAuthDecisionSchema = z
  .object({
    status: z.enum(['approved', 'partially-approved', 'rejected'], {
      errorMap: () => ({ message: 'Record approved, partially-approved or rejected' }),
    }),
    approvedAmount: z.coerce.number().min(0).optional().default(0),
    authorizationCode: optionalString(60),
    validUntil: optionalDate,
    notes: optionalString(1000),
  })
  .refine(
    (value) => value.status === 'rejected' || value.approvedAmount > 0,
    { message: 'An approval needs an amount', path: ['approvedAmount'] },
  );

// ---------------------------------------------------------------- claims ----

export const claimPreviewQuery = z.object({
  encounterId: objectId,
  policyId: objectId,
});

export const listClaimsQuery = extendListQuery({
  patientId: optionalObjectId,
  providerId: optionalObjectId,
  policyId: optionalObjectId,
  status: z.enum(CLAIM_STATUSES).optional(),
  openOnly: booleanFlag,
});

export const createClaimSchema = z.object({
  policyId: objectId,
  encounterId: objectId,
  /** Prefer the invoice's lines when the visit has already been billed. */
  invoiceId: optionalObjectId,
  /** Where advance approval was obtained, the claim quotes it. */
  preAuthId: optionalObjectId,
  notes: optionalString(2000),
});

export const submitClaimSchema = z.object({
  insurerReference: optionalString(80),
  notes: optionalString(1000),
});

export const claimDecisionSchema = z
  .object({
    status: z.enum(['under-review', 'approved', 'partially-approved', 'rejected'], {
      errorMap: () => ({ message: 'Record under-review, approved, partially-approved or rejected' }),
    }),
    approvedAmount: z.coerce.number().min(0).optional().default(0),
    rejectedAmount: z.coerce.number().min(0).optional().default(0),
    rejectionReason: optionalString(1000),
    insurerReference: optionalString(80),
    notes: optionalString(1000),
  })
  .refine(
    (value) => !['approved', 'partially-approved'].includes(value.status) || value.approvedAmount > 0,
    { message: 'An approval needs an amount', path: ['approvedAmount'] },
  )
  .refine(
    (value) => value.status !== 'rejected' || (value.rejectionReason ?? '').trim().length >= 5,
    { message: 'Give a rejection reason of at least 5 characters', path: ['rejectionReason'] },
  );

export const settleClaimSchema = z.object({
  settledAmount: z.coerce.number().min(0, 'A settlement amount is required'),
  insurerReference: optionalString(80),
  notes: optionalString(1000),
});

export const agingQuery = z.object({
  providerId: optionalObjectId,
});

export const settlementQuery = z.object({
  from: optionalDate,
  to: optionalDate,
  providerId: optionalObjectId,
});
