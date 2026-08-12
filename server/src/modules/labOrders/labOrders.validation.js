import { z } from 'zod';
import { LAB_ORDER_STATUSES, LAB_PRIORITIES } from '../../models/LabOrder.js';
import { RESULT_STATUSES } from '../../models/LabResult.js';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  extendListQuery,
} from '../../utils/commonSchemas.js';

export const listLabOrdersQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  orderedBy: optionalObjectId,
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  priority: z.enum(LAB_PRIORITIES).optional(),
  from: optionalDate,
  to: optionalDate,
  /** Worklist convenience: everything not yet completed or cancelled. */
  pendingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const createLabOrderSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  /** Catalogue ids — name, specimen and price are snapshotted server-side. */
  labTestIds: z
    .array(objectId)
    .min(1, 'Select at least one test')
    .max(30, 'An order may contain at most 30 tests'),
  priority: z.enum(LAB_PRIORITIES).optional().default('routine'),
  clinicalNotes: optionalString(2000),
  /**
   * Ordering clinician. Optional — defaults to the authenticated user when
   * they are a doctor. A nurse placing an order on a doctor's behalf must name
   * the doctor explicitly.
   */
  orderedBy: optionalObjectId,
});

export const collectSampleSchema = z.object({
  sampleId: optionalString(40),
  collectedAt: optionalDate,
});

export const cancelLabOrderSchema = z.object({
  reason: optionalString(500),
});

/** One analyte reading as typed by the technician. */
const resultEntrySchema = z.object({
  analyteCode: z.string().trim().min(1, 'Analyte code is required').max(16),
  // String, not number: techs legitimately enter '<0.01', 'Negative', 'Trace'.
  value: z.string().trim().min(1, 'A value is required').max(120),
  notes: optionalString(300),
});

export const submitResultSchema = z.object({
  labTestId: objectId,
  entries: z.array(resultEntrySchema).min(1, 'Enter at least one value').max(60),
  technicianNotes: optionalString(2000),
  interpretation: optionalString(2000),
  /**
   * 'preliminary' saves a draft; 'verified' signs it off and counts toward
   * order completion.
   */
  status: z.enum(['preliminary', 'verified']).optional().default('verified'),
});

export const amendResultSchema = z.object({
  entries: z.array(resultEntrySchema).min(1).max(60),
  technicianNotes: optionalString(2000),
  interpretation: optionalString(2000),
  amendmentReason: z
    .string()
    .trim()
    .min(5, 'An amendment reason is required')
    .max(500),
});

export const listResultsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  testCode: optionalString(16),
  status: z.enum(RESULT_STATUSES).optional(),
  abnormalOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
