import { z } from 'zod';
import {
  nonEmptyString,
  optionalString,
  phone,
  optionalPhone,
  optionalEmail,
  pastDate,
  optionalDate,
  extendListQuery,
} from '../../utils/commonSchemas.js';

export const GENDERS = ['male', 'female', 'other'];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'unknown'];
export const PATIENT_STATUSES = ['active', 'inactive', 'deceased'];

const addressSchema = z
  .object({
    line1: optionalString(160),
    line2: optionalString(160),
    city: optionalString(80),
    state: optionalString(80),
    postalCode: optionalString(20),
    country: optionalString(80),
  })
  .optional();

const emergencyContactSchema = z
  .object({
    name: optionalString(120),
    relationship: optionalString(60),
    phone: optionalPhone,
  })
  .optional();

const insuranceSchema = z
  .object({
    provider: optionalString(120),
    policyNumber: optionalString(80),
    validTill: optionalDate,
  })
  .optional();

export const listPatientsQuery = extendListQuery({
  status: z.enum(PATIENT_STATUSES).optional(),
  gender: z.enum(GENDERS).optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
});

const patientCore = {
  firstName: nonEmptyString(80, 'First name'),
  lastName: nonEmptyString(80, 'Last name'),
  dateOfBirth: pastDate,
  gender: z.enum(GENDERS, { errorMap: () => ({ message: 'Select a gender' }) }),
  bloodGroup: z.enum(BLOOD_GROUPS).optional().default('unknown'),
  maritalStatus: z.enum(MARITAL_STATUSES).optional().default('unknown'),
  phone,
  email: optionalEmail,
  nationalId: optionalString(40),
  address: addressSchema,
  emergencyContact: emergencyContactSchema,
  insurance: insuranceSchema,
  status: z.enum(PATIENT_STATUSES).optional().default('active'),
};

export const createPatientSchema = z.object({
  ...patientCore,

  /**
   * Set by the client only after a human has reviewed the flagged matches and
   * confirmed this is a different person. Requires the `overrideDuplicate`
   * permission and a reason, both checked in the controller.
   */
  acknowledgeDuplicates: z.boolean().optional().default(false),
  duplicateOverrideReason: optionalString(500),
});

/**
 * Body for the standalone duplicate check. Only the identifying fields are
 * needed — the front desk can run it from a half-filled form.
 */
export const checkDuplicatesSchema = z.object({
  firstName: optionalString(80),
  lastName: optionalString(80),
  dateOfBirth: optionalDate,
  gender: z.enum(GENDERS).optional(),
  phone: optionalPhone,
  email: optionalEmail,
  nationalId: optionalString(40),
  /** Exclude a record from its own results when checking during an edit. */
  excludeId: optionalString(24),
});

/** All fields optional on update; at least one must be present. */
export const updatePatientSchema = z
  .object({
    ...patientCore,
    bloodGroup: z.enum(BLOOD_GROUPS).optional(),
    maritalStatus: z.enum(MARITAL_STATUSES).optional(),
    status: z.enum(PATIENT_STATUSES).optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

// --- Medical history ---

const allergySchema = z.object({
  substance: nonEmptyString(120, 'Substance'),
  reaction: optionalString(200),
  severity: z.enum(['mild', 'moderate', 'severe']).optional().default('moderate'),
  notedAt: optionalDate,
});

const chronicConditionSchema = z.object({
  condition: nonEmptyString(160, 'Condition'),
  diagnosedOn: optionalDate,
  status: z.enum(['active', 'resolved', 'in-remission']).optional().default('active'),
  notes: optionalString(500),
});

const surgerySchema = z.object({
  procedure: nonEmptyString(160, 'Procedure'),
  performedOn: optionalDate,
  hospital: optionalString(160),
  notes: optionalString(500),
});

const medicationSchema = z.object({
  name: nonEmptyString(160, 'Medication name'),
  dosage: optionalString(80),
  frequency: optionalString(80),
  startedOn: optionalDate,
});

const familyHistorySchema = z.object({
  relation: nonEmptyString(60, 'Relation'),
  condition: nonEmptyString(160, 'Condition'),
  notes: optionalString(500),
});

/**
 * Whole-object replacement of medicalHistory. Sending the full arrays keeps the
 * client simple (edit-in-place forms) and avoids a patch-array protocol.
 */
export const updateMedicalHistorySchema = z
  .object({
    allergies: z.array(allergySchema).max(100).optional(),
    chronicConditions: z.array(chronicConditionSchema).max(100).optional(),
    pastSurgeries: z.array(surgerySchema).max(100).optional(),
    currentMedications: z.array(medicationSchema).max(100).optional(),
    familyHistory: z.array(familyHistorySchema).max(100).optional(),
    notes: optionalString(4000),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one medical history section to update',
  });
