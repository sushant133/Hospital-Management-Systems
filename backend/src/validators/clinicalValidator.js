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
import { CODE_SYSTEM_VALUES } from '../models/CodeSystem.js';
import { REGISTER_ENTRY_TYPES, DRUG_SCHEDULES } from '../models/ControlledDrugRegister.js';
import { MLC_CATEGORIES, MLC_STATUSES } from '../models/MedicoLegalCase.js';
import { DEATH_MANNERS, DEATH_PLACES, DELIVERY_TYPES, BIRTH_OUTCOMES } from '../models/VitalRecords.js';
import { PROBLEM_STATUSES, PROBLEM_SEVERITIES, CARE_PLAN_STATUSES, GOAL_STATUSES } from '../models/Problem.js';
import { HAI_TYPE_VALUES, DEVICE_TYPES, ISOLATION_TYPES, ANTIBIOTIC_TIERS } from '../models/InfectionControl.js';
import { REACTION_TYPES, REACTION_SEVERITIES } from '../models/Transfusion.js';
import {
  INCIDENT_CATEGORIES,
  HARM_LEVELS,
  INCIDENT_STATUSES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
} from '../models/ClinicalGovernance.js';
import { REFERRAL_REASONS, REFERRAL_URGENCY, REFERRAL_STATUSES } from '../models/Referral.js';
import { DISTRICT_CODES } from '../utils/nepal.js';

/** An embedded coded concept, as clinical records carry it. */
export const conceptSchema = z.object({
  system: z.enum(CODE_SYSTEM_VALUES),
  code: nonEmptyString(40, 'Code'),
  display: nonEmptyString(300, 'Display'),
  version: optionalString(20),
  text: optionalString(300),
});

/* ---------------------------------------------------------------- B1 ---- */

export const terminologySearchQuery = z.object({
  system: z.enum(CODE_SYSTEM_VALUES),
  q: nonEmptyString(120, 'Search text').min(2, 'Type at least two characters'),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  includeNonLeaf: z.union([z.boolean(), z.enum(['true', 'false'])]).optional()
    .transform((v) => v === true || v === 'true'),
});

export const terminologyValidateQuery = z.object({
  system: z.enum(CODE_SYSTEM_VALUES),
  code: nonEmptyString(40, 'Code'),
});

export const terminologyTranslateQuery = terminologyValidateQuery.extend({
  target: z.enum(CODE_SYSTEM_VALUES),
});

/* ---------------------------------------------------------------- B4 ---- */

export const acknowledgeAlertSchema = z.object({
  /**
   * A read-back is the safety standard for a verbally communicated critical
   * value, so how the result was received is recorded rather than assumed.
   */
  channel: z.enum(['in-app', 'phone-readback', 'in-person']).optional(),
  note: optionalString(1000),
});

export const alertActionSchema = z.object({
  actionTaken: nonEmptyString(1000, 'Action').min(
    10,
    'Say what was actually done — this is the line that gets read back to you later.',
  ),
});

export const listAlertsQuery = extendListQuery({
  status: optionalString(30),
  patientId: optionalObjectId,
  unacknowledgedOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional()
    .transform((v) => v === true || v === 'true'),
});

/* ---------------------------------------------------------------- B5 ---- */

export const registerEntrySchema = z
  .object({
    wardId: objectId,
    drugId: objectId,
    batchNumber: optionalString(60),
    entryType: z.enum(REGISTER_ENTRY_TYPES),
    quantity: z.number().refine((n) => n !== 0, 'Quantity cannot be zero'),
    unit: optionalString(30),
    witnessedBy: optionalObjectId,
    patientId: optionalObjectId,
    encounterId: optionalObjectId,
    prescriptionId: optionalObjectId,
    reason: optionalString(500),
    countedQuantity: z.number().optional(),
  })
  .refine((e) => e.entryType === 'receipt' || Boolean(e.witnessedBy), {
    message: 'A controlled drug movement must be witnessed by a second named person.',
    path: ['witnessedBy'],
  })
  .refine(
    (e) => !['wastage', 'count-adjustment'].includes(e.entryType) || (e.reason || '').trim().length >= 5,
    { message: 'Wastage and count adjustments need a stated reason.', path: ['reason'] },
  );

export const listRegisterQuery = extendListQuery({
  wardId: optionalObjectId,
  drugId: optionalObjectId,
  schedule: z.enum(DRUG_SCHEDULES).optional(),
  from: optionalDate,
  to: optionalDate,
});

/* ---------------------------------------------------------------- B6 ---- */

export const createMlcSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  category: z.enum(MLC_CATEGORIES),
  categoryNote: optionalString(500),
  incidentAt: optionalDate,
  incidentPlace: optionalString(300),
  incidentDistrict: z.enum(DISTRICT_CODES).optional().or(z.literal('')),
  broughtBy: optionalString(200),
  broughtByContact: optionalString(60),
  informantName: optionalString(200),
  informantRelation: optionalString(100),
  allegedHistory: optionalString(2000),
  triageTriggered: z.boolean().optional(),
});

export const informPoliceSchema = z.object({
  policeStation: nonEmptyString(200, 'Police station'),
  policeOfficerName: optionalString(200),
  policeOfficerContact: optionalString(60),
  firNumber: optionalString(60),
});

export const listMlcQuery = extendListQuery({
  category: z.enum(MLC_CATEGORIES).optional(),
  status: z.enum(MLC_STATUSES).optional(),
  patientId: optionalObjectId,
  awaitingPolice: z.union([z.boolean(), z.enum(['true', 'false'])]).optional()
    .transform((v) => v === true || v === 'true'),
});

/* ---------------------------------------------------------------- B7 ---- */

export const createDeathSchema = z.object({
  patientId: objectId,
  encounterId: optionalObjectId,
  diedAt: dateField,
  place: z.enum(DEATH_PLACES),
  wardId: optionalObjectId,
  manner: z.enum(DEATH_MANNERS).optional(),
  isMaternalDeath: z.boolean().optional(),
  isPerinatalDeath: z.boolean().optional(),
  postMortemRequired: z.boolean().optional(),
  medicoLegalCaseId: optionalObjectId,
});

export const certifyDeathSchema = z.object({
  causeChain: z
    .array(
      z.object({
        line: z.enum(['Ia', 'Ib', 'Ic', 'Id']),
        condition: nonEmptyString(300, 'Condition'),
        concept: conceptSchema.optional(),
        interval: optionalString(60),
      }),
    )
    .min(1, 'The cause-of-death chain needs at least one line.'),
  contributingConditions: z
    .array(z.object({ condition: nonEmptyString(300, 'Condition'), concept: conceptSchema.optional() }))
    .optional(),
  manner: z.enum(DEATH_MANNERS).optional(),
});

export const createBirthSchema = z.object({
  motherPatientId: objectId,
  babyPatientId: optionalObjectId,
  maternityCaseId: optionalObjectId,
  encounterId: optionalObjectId,
  bornAt: dateField,
  outcome: z.enum(BIRTH_OUTCOMES),
  deliveryType: z.enum(DELIVERY_TYPES),
  sex: z.enum(['male', 'female', 'ambiguous']),
  birthWeightGrams: z.coerce.number().min(0).max(8000).optional(),
  gestationWeeks: z.coerce.number().min(0).max(50).optional(),
  apgarOneMinute: z.coerce.number().min(0).max(10).optional(),
  apgarFiveMinute: z.coerce.number().min(0).max(10).optional(),
  birthOrder: z.coerce.number().int().min(1).optional(),
  totalInBirth: z.coerce.number().int().min(1).optional(),
  attendantType: z.enum(['doctor', 'nurse-midwife', 'anm', 'other']).optional(),
  motherName: optionalString(200),
  fatherName: optionalString(200),
});

/* ---------------------------------------------------------------- B8 ---- */

export const createProblemSchema = z.object({
  patientId: objectId,
  concept: conceptSchema.optional(),
  display: nonEmptyString(300, 'Problem'),
  severity: z.enum(PROBLEM_SEVERITIES).optional(),
  isChronic: z.boolean().optional(),
  isPriority: z.boolean().optional(),
  onsetDate: optionalDate,
  onsetEncounterId: optionalObjectId,
  notes: optionalString(2000),
});

export const resolveProblemSchema = z.object({
  resolvedDate: dateField,
  resolutionNote: optionalString(1000),
});

export const listProblemsQuery = extendListQuery({
  patientId: optionalObjectId,
  status: z.enum(PROBLEM_STATUSES).optional(),
  chronicOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional()
    .transform((v) => v === true || v === 'true'),
});

export const createCarePlanSchema = z.object({
  patientId: objectId,
  encounterId: optionalObjectId,
  problemIds: z.array(objectId).optional(),
  title: nonEmptyString(200, 'Title'),
  goals: z
    .array(
      z.object({
        description: nonEmptyString(500, 'Goal'),
        targetDate: optionalDate,
        measure: optionalString(300),
        status: z.enum(GOAL_STATUSES).optional(),
      }),
    )
    .optional(),
  interventions: z
    .array(
      z.object({
        description: nonEmptyString(500, 'Intervention'),
        frequency: optionalString(100),
        assignedRole: optionalString(60),
      }),
    )
    .optional(),
  reviewDue: optionalDate,
  status: z.enum(CARE_PLAN_STATUSES).optional(),
});

/* ---------------------------------------------------------------- B9 ---- */

export const insertDeviceSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  wardId: optionalObjectId,
  deviceType: z.enum(DEVICE_TYPES),
  site: optionalString(100),
  insertedAt: dateField,
  bundleCompliant: z.boolean().optional(),
  bundleNote: optionalString(500),
});

export const removeDeviceSchema = z.object({
  removedAt: dateField,
  removalReason: z
    .enum(['no-longer-needed', 'suspected-infection', 'blocked', 'dislodged', 'death', 'discharge'])
    .optional(),
});

export const reportHaiSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  wardId: optionalObjectId,
  haiType: z.enum(HAI_TYPE_VALUES),
  deviceDayId: optionalObjectId,
  surgeryId: optionalObjectId,
  onsetDate: dateField,
  presentOnAdmission: z.boolean().optional(),
  organism: optionalString(200),
  labOrderId: optionalObjectId,
  sensitivities: z
    .array(
      z.object({
        antibiotic: nonEmptyString(100, 'Antibiotic'),
        result: z.enum(['sensitive', 'intermediate', 'resistant']),
      }),
    )
    .optional(),
  isMultiDrugResistant: z.boolean().optional(),
  notes: optionalString(2000),
});

export const isolationSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  isolationType: z.enum(ISOLATION_TYPES),
  reason: nonEmptyString(500, 'Reason'),
  organism: optionalString(200),
  precautions: z.array(z.string().trim()).optional(),
});

export const antibioticRequestSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  prescriptionId: optionalObjectId,
  drugId: objectId,
  tier: z.enum(ANTIBIOTIC_TIERS),
  indication: nonEmptyString(500, 'Indication'),
  labOrderId: optionalObjectId,
  cultureOrganism: optionalString(200),
  isEmpirical: z.boolean().optional(),
  approvedDays: z.coerce.number().int().min(1).max(30).optional(),
});

export const antibioticDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  decisionNote: optionalString(1000),
  approvedDays: z.coerce.number().int().min(1).max(30).optional(),
});

/* --------------------------------------------------------------- B10 ---- */

export const prepareTransfusionSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  bloodRequestId: optionalObjectId,
  bloodUnitId: objectId,
});

export const bedsideCheckSchema = z.object({
  /** The second signature. The model refuses if it equals the checker. */
  witnessedBy: objectId,
  checks: z.object({
    patientIdentityConfirmed: z.literal(true, {
      errorMap: () => ({ message: 'Patient identity must be confirmed at the bedside.' }),
    }),
    unitLabelMatches: z.literal(true, {
      errorMap: () => ({ message: 'The unit label must be checked against the patient.' }),
    }),
    groupCompatible: z.literal(true, {
      errorMap: () => ({ message: 'Group compatibility must be confirmed.' }),
    }),
    expiryChecked: z.literal(true, {
      errorMap: () => ({ message: 'The unit expiry must be checked.' }),
    }),
    unitIntact: z.literal(true, {
      errorMap: () => ({ message: 'The unit must be inspected for integrity.' }),
    }),
    consentConfirmed: z.boolean().optional(),
  }),
});

export const observationSchema = z.object({
  atMinutes: z.coerce.number().int().min(0),
  temperature: z.coerce.number().optional(),
  pulse: z.coerce.number().optional(),
  systolic: z.coerce.number().optional(),
  diastolic: z.coerce.number().optional(),
  respiratoryRate: z.coerce.number().optional(),
  oxygenSaturation: z.coerce.number().optional(),
  note: optionalString(500),
});

export const reactionSchema = z.object({
  reactionType: z.enum(REACTION_TYPES),
  severity: z.enum(REACTION_SEVERITIES),
  onsetAt: dateField,
  minutesIntoTransfusion: z.coerce.number().int().min(0).optional(),
  symptoms: z.array(z.string().trim()).optional(),
  vitalsAtOnset: z
    .object({
      temperature: z.coerce.number().optional(),
      pulse: z.coerce.number().optional(),
      systolic: z.coerce.number().optional(),
      diastolic: z.coerce.number().optional(),
      oxygenSaturation: z.coerce.number().optional(),
    })
    .optional(),
  immediateAction: optionalString(1000),
});

/* --------------------------------------------------------------- B11 ---- */

export const createIncidentSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  harmLevel: z.enum(HARM_LEVELS),
  occurredAt: dateField,
  wardId: optionalObjectId,
  departmentId: optionalObjectId,
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  description: nonEmptyString(4000, 'Description').min(20, 'Describe what happened in at least 20 characters.'),
  immediateAction: optionalString(2000),
  /** Anonymity is honoured by the model, which nulls the reporter. */
  isAnonymous: z.boolean().optional(),
});

export const investigateIncidentSchema = z.object({
  severityScore: z.coerce.number().int().min(1).max(25).optional(),
  contributingFactors: z
    .array(
      z.object({
        factor: z.enum([
          'staffing', 'workload', 'training', 'communication', 'equipment',
          'medication-labelling', 'protocol-absent', 'protocol-not-followed',
          'environment', 'patient-factors', 'other',
        ]),
        note: optionalString(500),
      }),
    )
    .optional(),
  rootCause: optionalString(2000),
  actions: z
    .array(
      z.object({
        description: nonEmptyString(500, 'Action'),
        ownerId: optionalObjectId,
        dueDate: optionalDate,
      }),
    )
    .optional(),
  lessonsLearned: optionalString(2000),
});

export const listIncidentsQuery = extendListQuery({
  category: z.enum(INCIDENT_CATEGORIES).optional(),
  harmLevel: z.enum(HARM_LEVELS).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  wardId: optionalObjectId,
  from: optionalDate,
  to: optionalDate,
});

export const createComplaintSchema = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  isCompliment: z.boolean().optional(),
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  departmentId: optionalObjectId,
  complainantName: optionalString(200),
  complainantRelation: optionalString(100),
  complainantContact: optionalString(60),
  isAnonymous: z.boolean().optional(),
  receivedVia: z.enum(['in-person', 'phone', 'letter', 'suggestion-box', 'portal', 'sms', 'other']).optional(),
  description: nonEmptyString(4000, 'Description'),
});

export const resolveComplaintSchema = z.object({
  resolution: nonEmptyString(2000, 'Resolution').min(10, 'Say how it was resolved.'),
  complainantInformed: z.boolean().optional(),
  complainantSatisfied: z.boolean().optional(),
});

export const listComplaintsQuery = extendListQuery({
  category: z.enum(COMPLAINT_CATEGORIES).optional(),
  status: z.enum(COMPLAINT_STATUSES).optional(),
  overdueOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional()
    .transform((v) => v === true || v === 'true'),
});

/* ----------------------------------------------------------- C1 REFERRAL - */

export const createReferralSchema = z.object({
  direction: z.enum(['inbound', 'outbound']),
  patientId: objectId,
  encounterId: optionalObjectId,
  facilityCode: optionalString(50),
  facilityName: nonEmptyString(200, 'Facility name'),
  facilityLevel: z
    .enum(['community', 'health-post', 'phcc', 'primary', 'district', 'provincial', 'central', 'private', 'abroad'])
    .optional(),
  facilityDistrict: z.enum(DISTRICT_CODES).optional().or(z.literal('')),
  counterpartDoctor: optionalString(200),
  counterpartContact: optionalString(60),
  isFirstContactPoint: z.boolean().optional(),
  urgency: z.enum(REFERRAL_URGENCY).optional(),
  reason: z.enum(REFERRAL_REASONS),
  reasonNote: optionalString(1000),
  diagnosis: z.array(conceptSchema).optional(),
  clinicalSummary: optionalString(4000),
  investigationsDone: optionalString(2000),
  treatmentGiven: optionalString(2000),
  referredToSpecialty: optionalString(120),
  referralDate: optionalDate,
});

export const referralOutcomeSchema = z.object({
  outcome: z.enum(['treated-returned', 'treated-retained', 'admitted', 'died', 'referred-onward', 'not-attended']),
  outcomeSummary: optionalString(4000),
  outcomeDiagnosis: z.array(conceptSchema).optional(),
  followUpPlan: optionalString(2000),
});

export const listReferralsQuery = extendListQuery({
  direction: z.enum(['inbound', 'outbound']).optional(),
  status: z.enum(REFERRAL_STATUSES).optional(),
  patientId: optionalObjectId,
  urgency: z.enum(REFERRAL_URGENCY).optional(),
  /** Sent out, acknowledged, and still no outcome — the loop that never closed. */
  awaitingOutcome: z.union([z.boolean(), z.enum(['true', 'false'])]).optional()
    .transform((v) => v === true || v === 'true'),
});
