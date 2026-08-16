import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  nonEmptyString,
  extendListQuery,
} from '../utils/commonSchemas.js';
import { ESI_LEVELS, TRIAGE_STATUSES } from '../models/Triage.js';

export const listTriageQuery = extendListQuery({
  status: z.enum(TRIAGE_STATUSES).optional(),
  esi: z.coerce.number().int().min(1).max(5).optional(),
  patientId: optionalObjectId,
  waitingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const vitalsSchema = z
  .object({
    temperatureC: z.coerce.number().min(30).max(45).optional(),
    pulseBpm: z.coerce.number().int().min(0).max(300).optional(),
    respiratoryRate: z.coerce.number().int().min(0).max(80).optional(),
    systolicBp: z.coerce.number().int().min(0).max(300).optional(),
    diastolicBp: z.coerce.number().int().min(0).max(200).optional(),
    spo2: z.coerce.number().int().min(0).max(100).optional(),
    gcs: z.coerce.number().int().min(3).max(15).optional(),
  })
  .optional();

const traumaSchema = z
  .object({
    isTrauma: z.boolean().optional().default(false),
    airway: optionalString(400),
    breathing: optionalString(400),
    circulation: optionalString(400),
    disability: optionalString(400),
    exposure: optionalString(400),
  })
  .optional();

export const createTriageSchema = z.object({
  patientId: objectId,
  encounterId: optionalObjectId,
  chiefComplaint: nonEmptyString(400, 'Chief complaint'),
  esi: z.coerce.number().int().refine((v) => ESI_LEVELS.includes(v), { message: 'ESI must be 1–5' }),
  mechanism: optionalString(400),
  vitals: vitalsSchema,
  trauma: traumaSchema,
  notes: optionalString(2000),
  assignedTo: optionalObjectId,
  openEncounter: z.boolean().optional().default(true),
});

export const updateTriageSchema = z
  .object({
    chiefComplaint: optionalString(400),
    esi: z.coerce.number().int().min(1).max(5).optional(),
    mechanism: optionalString(400),
    vitals: vitalsSchema,
    trauma: traumaSchema,
    notes: optionalString(2000),
    status: z.enum(TRIAGE_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const assignTriageSchema = z.object({
  assignedTo: objectId,
});

export const disposeTriageSchema = z.object({
  status: z.enum(['admitted', 'discharged', 'lwbs', 'transferred']),
  notes: optionalString(1000),
});
