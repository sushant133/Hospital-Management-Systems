import { z } from 'zod';
import { RADIOLOGY_ORDER_STATUSES, RADIOLOGY_PRIORITIES } from '../models/RadiologyOrder.js';
import { RADIOLOGY_RESULT_STATUSES } from '../models/RadiologyResult.js';
import { MODALITIES } from '../models/RadiologyExam.js';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  extendListQuery,
} from '../utils/commonSchemas.js';

export const listRadiologyOrdersQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  orderedBy: optionalObjectId,
  examId: optionalObjectId,
  status: z.enum(RADIOLOGY_ORDER_STATUSES).optional(),
  priority: z.enum(RADIOLOGY_PRIORITIES).optional(),
  modality: z.enum(MODALITIES).optional(),
  from: optionalDate,
  to: optionalDate,
  scheduledFrom: optionalDate,
  scheduledTo: optionalDate,
  /** Worklist convenience: everything not yet completed or cancelled. */
  pendingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const createRadiologyOrderSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  /** Catalogue id — name, modality, body part and price are snapshotted server-side. */
  examId: objectId,
  priority: z.enum(RADIOLOGY_PRIORITIES).optional().default('routine'),
  clinicalIndication: z
    .string()
    .trim()
    .min(8, 'Give a clinical indication (at least 8 characters)')
    .max(2000),
  /**
   * Ordering clinician. Optional — defaults to the authenticated user when
   * they are a doctor. A nurse placing an order on a doctor's behalf must name
   * the doctor explicitly.
   */
  orderedBy: optionalObjectId,
});

export const scheduleOrderSchema = z.object({
  scheduledFor: z.coerce.date({ invalid_type_error: 'A schedule time is required' }),
});

export const startStudySchema = z.object({
  acquisitionNotes: optionalString(2000),
});

export const cancelRadiologyOrderSchema = z.object({
  reason: optionalString(500),
});

export const submitRadiologyResultSchema = z
  .object({
    technique: optionalString(500),
    findings: z.string().trim().min(8, 'Findings are required').max(8000),
    impression: z.string().trim().min(4, 'An impression is required').max(4000),
    recommendation: optionalString(2000),
    isCritical: z.boolean().optional().default(false),
    criticalNote: optionalString(1000),
    /**
     * 'preliminary' saves a draft; 'verified' signs it off and completes the order.
     */
    status: z.enum(['preliminary', 'verified']).optional().default('verified'),
  })
  .refine((data) => !data.isCritical || (data.criticalNote && data.criticalNote.trim().length >= 4), {
    message: 'Say what the critical finding is',
    path: ['criticalNote'],
  });

export const amendRadiologyResultSchema = z
  .object({
    technique: optionalString(500),
    findings: z.string().trim().min(8, 'Findings are required').max(8000),
    impression: z.string().trim().min(4, 'An impression is required').max(4000),
    recommendation: optionalString(2000),
    isCritical: z.boolean().optional(),
    criticalNote: optionalString(1000),
    amendmentReason: z.string().trim().min(5, 'An amendment reason is required').max(500),
  })
  .refine(
    (data) => data.isCritical !== true || (data.criticalNote && data.criticalNote.trim().length >= 4),
    {
      message: 'Say what the critical finding is',
      path: ['criticalNote'],
    },
  );

export const listRadiologyResultsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  radiologyOrderId: optionalObjectId,
  status: z.enum(RADIOLOGY_RESULT_STATUSES).optional(),
  criticalOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
