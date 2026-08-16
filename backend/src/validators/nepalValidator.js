import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  nonEmptyString,
  dateField,
  optionalDate,
  extendListQuery,
} from '../utils/commonSchemas.js';
import {
  PROVINCE_CODES,
  DISTRICT_CODES,
  ID_TYPE_VALUES,
  MAX_BS_YEAR,
  MIN_BS_YEAR,
  MAX_WARD_NO,
  isNepaliMobile,
  DISABILITY_CATEGORIES,
} from '../utils/nepal.js';
import { COVERAGE_MODE_VALUES, CEILING_PERIODS, CLAIM_ROUTES } from '../models/Scheme.js';
import { SCHEME_CLAIM_STATUSES } from '../models/SchemeClaim.js';
import { ENTITLEMENT_STATUSES } from '../models/PatientEntitlement.js';
import { HIB_MEMBER_RELATIONSHIPS, HIB_HOUSEHOLD_STATUSES } from '../models/HibHousehold.js';
import { CREDIT_NOTE_REASONS } from '../models/CreditNote.js';
import { GATEWAY_PROVIDER_VALUES } from '../models/GatewayTransaction.js';
import { HMIS_RETURN_STATUSES } from '../models/HmisReturn.js';
import { SMS_TEMPLATES } from '../models/SmsMessage.js';

/* ==========================================================================
 * SHARED NEPAL FIELD TYPES
 * ======================================================================= */

/**
 * A Nepali mobile number.
 *
 * Stricter than the generic `phone` in commonSchemas, and deliberately so: the
 * SMS gateway silently drops anything that is not a real 98/97 mobile, and a
 * number that fails at send time is discovered days later when the patient
 * says nobody called them.
 */
export const nepaliMobile = z
  .string()
  .trim()
  .refine(isNepaliMobile, 'Enter a Nepali mobile number (10 digits, starting 97 or 98)');

export const optionalNepaliPhone = z
  .union([z.string().trim(), z.literal('')])
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/** A Nepali address. Codes, never free-text place names — reports group on them. */
export const nepalAddress = z.object({
  provinceCode: z.enum(PROVINCE_CODES).optional().or(z.literal('')),
  districtCode: z.enum(DISTRICT_CODES).optional().or(z.literal('')),
  localLevelCode: optionalString(32),
  localLevelName: optionalString(120),
  wardNo: z.coerce.number().int().min(1).max(MAX_WARD_NO).nullable().optional(),
  tole: optionalString(200),
  foreignAddress: optionalString(300),
  country: optionalString(2),
});

/**
 * One identity document.
 *
 * The refinement is the important part: a citizenship or birth-certificate
 * number without its issuing district is not an identity, because numbers are
 * issued per district. Accepting one would eventually merge two strangers'
 * charts, so it is rejected at the edge rather than stored as a weak signal.
 */
export const identifierSchema = z
  .object({
    type: z.enum(ID_TYPE_VALUES),
    value: nonEmptyString(40, 'Document number'),
    issuingDistrict: z.enum(DISTRICT_CODES).nullable().optional(),
    issuedOn: optionalDate,
    category: z.enum(Object.values(DISABILITY_CATEGORIES)).nullable().optional(),
  })
  .refine(
    (id) => !['citizenship', 'birth_certificate'].includes(id.type) || Boolean(id.issuingDistrict),
    {
      message: 'A citizenship or birth certificate number needs its issuing district.',
      path: ['issuingDistrict'],
    },
  );

/** A BS date as `{ year, month, day }` — used by report period selectors. */
export const bsDate = z.object({
  year: z.coerce.number().int().min(MIN_BS_YEAR).max(MAX_BS_YEAR),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(32).optional(),
});

/* ==========================================================================
 * REFERENCE DATA
 * ======================================================================= */

export const localLevelQuery = z.object({
  district: z.enum(DISTRICT_CODES),
});

export const convertDateQuery = z
  .object({
    ad: z.string().trim().optional(),
    bs: z.string().trim().optional(),
  })
  .refine((q) => Boolean(q.ad) !== Boolean(q.bs), {
    message: 'Give exactly one of `ad` or `bs`.',
  });

/* ==========================================================================
 * SCHEMES (A7)
 * ======================================================================= */

const eligibilityRule = z.object({
  field: z.enum([
    'age-min',
    'age-max',
    'gender',
    'has-identifier',
    'identifier-category',
    'diagnosis-in',
    'service-in',
    'district-in',
    'income-below',
  ]),
  value: z.any(),
  description: optionalString(200),
});

export const createSchemeSchema = z.object({
  code: nonEmptyString(50, 'Scheme code').toLowerCase(),
  name: nonEmptyString(150, 'Scheme name'),
  nameNe: nonEmptyString(150, 'Nepali name'),
  description: optionalString(1000),
  coverageMode: z.enum(COVERAGE_MODE_VALUES),
  coveragePercent: z.coerce.number().min(0).max(100).optional(),
  flatAmount: z.coerce.number().min(0).optional(),
  ceilingAmount: z.coerce.number().min(0).optional(),
  ceilingPeriod: z.enum(CEILING_PERIODS).optional(),
  coveredSourceTypes: z.array(z.string().trim()).optional(),
  coveredServiceCodes: z.array(z.string().trim()).optional(),
  excludedServiceCodes: z.array(z.string().trim()).optional(),
  eligibility: z.array(eligibilityRule).optional(),
  claimRoute: z.enum(CLAIM_ROUTES),
  claimWindowDays: z.coerce.number().int().min(0).max(3650).optional(),
  requiresDocument: z.boolean().optional(),
  documentLabel: optionalString(120),
  effectiveFrom: optionalDate,
  effectiveTo: optionalDate,
  authorityReference: optionalString(300),
});

export const updateSchemeSchema = createSchemeSchema.partial().omit({ code: true });

export const listSchemesQuery = extendListQuery({
  claimRoute: z.enum(CLAIM_ROUTES).optional(),
  effectiveOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

/* ==========================================================================
 * ENTITLEMENTS
 * ======================================================================= */

export const createEntitlementSchema = z.object({
  patientId: objectId,
  schemeId: objectId,
  documentNumber: optionalString(60),
  documentIssuedBy: optionalString(150),
  documentIssuedOn: optionalDate,
  validFrom: optionalDate,
  validTo: optionalDate,
});

export const verifyEntitlementSchema = z.object({
  /**
   * Free text, but required and substantive: this is the note that answers
   * "on what basis was free care applied to this patient" years later.
   */
  verificationNote: nonEmptyString(500, 'Verification note').min(
    10,
    'Say what document you sighted — at least 10 characters.',
  ),
});

export const revokeEntitlementSchema = z.object({
  revokeReason: nonEmptyString(500, 'Reason').min(10, 'Give a reason of at least 10 characters.'),
});

export const listEntitlementsQuery = extendListQuery({
  patientId: optionalObjectId,
  schemeCode: optionalString(50),
  status: z.enum(ENTITLEMENT_STATUSES).optional(),
  unverifiedOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const eligibilityQuery = z.object({
  patientId: objectId,
  encounterId: optionalObjectId,
  diagnosisCodes: z.union([z.string(), z.array(z.string())]).optional(),
  serviceCodes: z.union([z.string(), z.array(z.string())]).optional(),
});

/* ==========================================================================
 * SCHEME CLAIMS
 * ======================================================================= */

export const listSchemeClaimsQuery = extendListQuery({
  schemeCode: optionalString(50),
  status: z.enum(SCHEME_CLAIM_STATUSES).optional(),
  patientId: optionalObjectId,
  fiscalYear: optionalString(10),
  lapsingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const submitClaimSchema = z.object({
  externalReference: optionalString(100),
});

export const claimDecisionSchema = z
  .object({
    status: z.enum(['approved', 'partially-approved', 'rejected']),
    approvedAmount: z.coerce.number().min(0).optional(),
    decisionNote: optionalString(1000),
    rejectionReason: optionalString(500),
  })
  .refine((d) => d.status === 'rejected' || d.approvedAmount !== undefined, {
    message: 'An approved or partially approved claim needs the amount agreed.',
    path: ['approvedAmount'],
  })
  .refine((d) => d.status !== 'rejected' || Boolean(d.rejectionReason), {
    message: 'A rejected claim needs a reason — it is what the resubmission is built from.',
    path: ['rejectionReason'],
  });

/* ==========================================================================
 * HIB (A6)
 * ======================================================================= */

const hibMember = z.object({
  memberNumber: nonEmptyString(40, 'Member number'),
  patientId: optionalObjectId,
  nameAsRegistered: nonEmptyString(150, 'Name'),
  relationship: z.enum(HIB_MEMBER_RELATIONSHIPS),
  dateOfBirth: optionalDate,
  gender: z.enum(['male', 'female', 'other']).optional(),
  enrolledOn: optionalDate,
});

export const createHouseholdSchema = z.object({
  householdNumber: nonEmptyString(40, 'Household number'),
  members: z.array(hibMember).min(1, 'A household needs at least one member.'),
  districtCode: z.enum(DISTRICT_CODES).optional().or(z.literal('')),
  localLevelCode: optionalString(32),
  firstContactPointCode: optionalString(50),
  firstContactPointName: optionalString(150),
  policyFrom: dateField,
  policyTo: dateField,
  ceilingAmount: z.coerce.number().min(0),
  premiumAmount: z.coerce.number().min(0).optional(),
  premiumPaidOn: optionalDate,
  subsidised: z.boolean().optional(),
  subsidyCategory: optionalString(100),
  requiresReferral: z.boolean().optional(),
  copayPercent: z.coerce.number().min(0).max(100).optional(),
});

export const updateHouseholdSchema = createHouseholdSchema
  .partial()
  .omit({ householdNumber: true });

export const linkMemberSchema = z.object({
  memberNumber: nonEmptyString(40, 'Member number'),
  patientId: objectId,
});

export const hibEligibilityQuery = z.object({
  patientId: objectId,
  encounterId: optionalObjectId,
});

export const listHouseholdsQuery = extendListQuery({
  status: z.enum(HIB_HOUSEHOLD_STATUSES).optional(),
  districtCode: z.enum(DISTRICT_CODES).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

/* ==========================================================================
 * CREDIT NOTES (A8)
 * ======================================================================= */

export const createCreditNoteSchema = z
  .object({
    invoiceId: objectId,
    lines: z
      .array(
        z.object({
          lineItemId: optionalObjectId,
          description: nonEmptyString(300, 'Description'),
          amount: z.coerce.number().min(0.01, 'A credited line must be more than zero.'),
          taxAmount: z.coerce.number().min(0).optional(),
        }),
      )
      .min(1, 'A credit note needs at least one line.'),
    reason: z.enum(CREDIT_NOTE_REASONS),
    reasonNote: optionalString(1000),
  })
  .refine((n) => n.reason !== 'other' || (n.reasonNote && n.reasonNote.trim().length >= 10), {
    message: 'Give a reason of at least 10 characters when the reason is "other".',
    path: ['reasonNote'],
  });

export const listCreditNotesQuery = extendListQuery({
  invoiceId: optionalObjectId,
  patientId: optionalObjectId,
  fiscalYear: optionalString(10),
  reason: z.enum(CREDIT_NOTE_REASONS).optional(),
});

/* ==========================================================================
 * GATEWAY PAYMENTS (A10)
 * ======================================================================= */

export const initiatePaymentSchema = z.object({
  invoiceId: objectId,
  provider: z.enum(GATEWAY_PROVIDER_VALUES),
  /**
   * Optional. When omitted the outstanding balance is collected. The controller
   * re-derives the amount from the invoice regardless — a client that could
   * name its own figure could settle a 50,000 rupee bill for one rupee.
   */
  amount: z.coerce.number().min(0.01).optional(),
});

export const verifyPaymentSchema = z.object({
  reference: nonEmptyString(40, 'Payment reference'),
});

export const reconcileSchema = z.object({
  provider: z.enum(GATEWAY_PROVIDER_VALUES),
  settledOn: optionalDate,
  rows: z
    .array(
      z.object({
        providerTransactionId: nonEmptyString(100, 'Provider transaction id'),
        amount: z.coerce.number().min(0),
        fee: z.coerce.number().min(0).optional(),
        settlementReference: optionalString(100),
      }),
    )
    .min(1, 'The settlement file has no rows.'),
});

export const listGatewayTxnQuery = extendListQuery({
  provider: z.enum(GATEWAY_PROVIDER_VALUES).optional(),
  status: z.string().trim().optional(),
  invoiceId: optionalObjectId,
  unsettledOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

/* ==========================================================================
 * SMS (A11)
 * ======================================================================= */

export const sendSmsSchema = z.object({
  to: nepaliMobile,
  template: z.enum(Object.values(SMS_TEMPLATES)),
  locale: z.enum(['ne', 'en']).optional(),
  values: z.record(z.any()).optional(),
  patientId: optionalObjectId,
  sendAfter: optionalDate,
});

export const listSmsQuery = extendListQuery({
  status: z.string().trim().optional(),
  template: z.string().trim().optional(),
  patientId: optionalObjectId,
  from: optionalDate,
  to: optionalDate,
});

/* ==========================================================================
 * HMIS (A9)
 * ======================================================================= */

export const generateReturnSchema = z.object({
  bsYear: z.coerce.number().int().min(MIN_BS_YEAR).max(MAX_BS_YEAR),
  bsMonth: z.coerce.number().int().min(1).max(12),
  restatementReason: optionalString(500),
});

export const reviewReturnSchema = z.object({
  reviewNotes: optionalString(1000),
  /** Manual corrections, each needing a stated reason. */
  overrides: z
    .array(
      z.object({
        code: nonEmptyString(50, 'Indicator code'),
        value: z.coerce.number().min(0),
        reason: nonEmptyString(300, 'Reason').min(
          10,
          'Say why the computed figure is being overridden — at least 10 characters.',
        ),
      }),
    )
    .optional(),
});

export const listReturnsQuery = extendListQuery({
  status: z.enum(HMIS_RETURN_STATUSES).optional(),
  bsYear: z.coerce.number().int().min(MIN_BS_YEAR).max(MAX_BS_YEAR).optional(),
  fiscalYear: optionalString(10),
});
