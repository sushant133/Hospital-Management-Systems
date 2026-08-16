import { z } from 'zod';
import { optionalObjectId, optionalString, optionalDate } from '../utils/commonSchemas.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

/**
 * Bounds mirror the model's. They are physiological limits, not reference
 * ranges — a temperature of 41°C is alarming but real, so it is accepted and
 * flagged rather than rejected. Only impossible values are refused here.
 */
export const recordVitalsSchema = z
  .object({
    temperatureC: z.coerce.number().min(25).max(45).optional(),
    pulseBpm: z.coerce.number().int().min(0).max(300).optional(),
    respiratoryRate: z.coerce.number().int().min(0).max(120).optional(),
    systolicBp: z.coerce.number().int().min(0).max(300).optional(),
    diastolicBp: z.coerce.number().int().min(0).max(200).optional(),
    spo2: z.coerce.number().min(0).max(100).optional(),
    weightKg: z.coerce.number().min(0).max(500).optional(),
    heightCm: z.coerce.number().min(0).max(300).optional(),
    painScore: z.coerce.number().int().min(0).max(10).optional(),
    recordedAt: optionalDate,
    notes: optionalString(1000),
  })
  .refine(
    (v) =>
      [
        'temperatureC',
        'pulseBpm',
        'respiratoryRate',
        'systolicBp',
        'diastolicBp',
        'spo2',
        'weightKg',
        'heightCm',
        'painScore',
      ].some((field) => v[field] !== undefined),
    { message: 'Record at least one measurement' },
  )
  .refine((v) => v.systolicBp === undefined || v.diastolicBp === undefined || v.systolicBp > v.diastolicBp, {
    message: 'Systolic pressure must be higher than diastolic',
    path: ['systolicBp'],
  });

export const patientVitalsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  encounterId: optionalObjectId,
  from: optionalDate,
  to: optionalDate,
  abnormalOnly: booleanFlag,
  includeInactive: booleanFlag,
});

export const TIMELINE_TYPES = [
  'encounter',
  'note',
  'vitals',
  'labOrder',
  'labResult',
  'radiologyOrder',
  'radiologyResult',
  'prescription',
  'dispense',
  'appointment',
];

export const timelineQuery = z.object({
  from: optionalDate,
  to: optionalDate,
  limit: z.coerce.number().int().min(1).max(500).default(200),
  /** `?types=note,vitals` narrows the merge to the strands you care about. */
  types: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const list = Array.isArray(value) ? value : String(value).split(',');
      return list.map((v) => v.trim()).filter((v) => TIMELINE_TYPES.includes(v));
    }),
});
