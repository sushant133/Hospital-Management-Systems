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
  DRUG_FORMS,
  DRUG_ROUTES,
  BATCH_STATUSES,
  PRESCRIPTION_STATUSES,
} from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

const drugCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Drug code is too short')
  .max(24, 'Drug code is too long')
  .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only');

// ------------------------------------------------------------ formulary ----

export const listDrugsQuery = extendListQuery({
  form: z.enum(DRUG_FORMS).optional(),
  isControlled: booleanFlag,
  lowStockOnly: booleanFlag,
});

export const createDrugSchema = z.object({
  drugCode,
  name: nonEmptyString(160, 'Drug name'),
  genericName: nonEmptyString(160, 'Generic name'),
  form: z.enum(DRUG_FORMS, { errorMap: () => ({ message: 'Select a dosage form' }) }),
  strength: nonEmptyString(60, 'Strength'),
  unit: nonEmptyString(24, 'Unit'),
  defaultRoute: z.enum(DRUG_ROUTES).optional().default('oral'),
  atcCode: optionalString(16),
  manufacturer: optionalString(160),
  sellingPrice: z.coerce.number().min(0, 'Price cannot be negative'),
  reorderLevel: z.coerce.number().int().min(0).optional().default(0),
  isControlled: z.boolean().optional().default(false),
  /** Lowercased server-side; matched against recorded allergies at dispense. */
  allergenClasses: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  cautions: optionalString(1000),
});

export const updateDrugSchema = createDrugSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nothing to update' },
);

// --------------------------------------------------------------- batches ----

export const listBatchesQuery = extendListQuery({
  drugId: optionalObjectId,
  status: z.enum(BATCH_STATUSES).optional(),
  inStockOnly: booleanFlag,
  expiringBefore: optionalDate,
});

export const receiveBatchSchema = z.object({
  drugId: objectId,
  batchNo: nonEmptyString(60, 'Batch number'),
  expiryDate: z.coerce.date({ invalid_type_error: 'A valid expiry date is required' }),
  quantityReceived: z.coerce.number().int().min(1, 'Receive at least one unit'),
  costPrice: z.coerce.number().min(0).optional().default(0),
  supplier: optionalString(160),
  receivedAt: optionalDate,
});

export const adjustBatchSchema = z.object({
  action: z.enum(['write-off', 'quarantine', 'release', 'mark-expired'], {
    errorMap: () => ({ message: 'Choose write-off, quarantine, release or mark-expired' }),
  }),
  /** Only meaningful for a write-off; ignored otherwise. */
  quantity: z.coerce.number().int().min(1).optional(),
  /**
   * Required for every adjustment. Stock that changes without a stated reason
   * cannot be reconciled, and write-offs are exactly what an audit looks at.
   */
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500),
}).refine((value) => value.action !== 'write-off' || value.quantity > 0, {
  message: 'Say how many units are being written off',
  path: ['quantity'],
});

export const alertsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(90),
});

// ----------------------------------------------------------- prescribing ----

const prescriptionItemSchema = z.object({
  drugId: objectId,
  dosage: nonEmptyString(80, 'Dosage'),
  frequency: nonEmptyString(80, 'Frequency'),
  durationDays: z.coerce.number().int().min(0).max(365).optional(),
  route: z.enum(DRUG_ROUTES).optional(),
  instructions: optionalString(500),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
});

export const listPrescriptionsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  prescribedBy: optionalObjectId,
  status: z.enum(PRESCRIPTION_STATUSES).optional(),
  pendingOnly: booleanFlag,
});

export const createPrescriptionSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  items: z.array(prescriptionItemSchema).min(1, 'Prescribe at least one item').max(30),
  notes: optionalString(2000),
});

export const cancelPrescriptionSchema = z.object({
  reason: optionalString(500),
});

// ------------------------------------------------------------ dispensing ----

export const dispenseSchema = z
  .object({
    /** Omit to dispense everything still outstanding. */
    items: z
      .array(
        z.object({
          prescriptionItemId: objectId,
          quantity: z.coerce.number().int().min(1).optional(),
        }),
      )
      .max(30)
      .optional(),
    /**
     * Dispensing despite a recorded allergy. Gated on its own permission and
     * re-checked in the controller, so setting this flag alone achieves nothing.
     */
    overrideAllergyWarning: z.boolean().optional().default(false),
    overrideReason: optionalString(500),
    notes: optionalString(1000),
  })
  .refine(
    (value) =>
      !value.overrideAllergyWarning ||
      (value.overrideReason && value.overrideReason.trim().length >= 10),
    {
      message: 'Give a reason of at least 10 characters to override an allergy warning',
      path: ['overrideReason'],
    },
  );

export const listDispensesQuery = extendListQuery({
  patientId: optionalObjectId,
  prescriptionId: optionalObjectId,
  batchId: optionalObjectId,
  overriddenOnly: booleanFlag,
});

export const returnDispenseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500),
});
