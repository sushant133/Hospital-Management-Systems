import { z } from 'zod';
import { ENCOUNTER_TYPES, ENCOUNTER_STATUSES } from '../models/Encounter.js';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  extendListQuery,
} from '../utils/commonSchemas.js';

export const listEncountersQuery = extendListQuery({
  patientId: optionalObjectId,
  departmentId: optionalObjectId,
  attendingDoctorId: optionalObjectId,
  type: z.enum(ENCOUNTER_TYPES).optional(),
  status: z.enum(ENCOUNTER_STATUSES).optional(),
  from: optionalDate,
  to: optionalDate,
});

const diagnosisSchema = z.object({
  code: optionalString(20),
  description: z.string().trim().min(1, 'Diagnosis description is required').max(300),
  type: z.enum(['primary', 'secondary', 'provisional']).optional().default('primary'),
});

const vitalsSchema = z.object({
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
});

export const createEncounterSchema = z.object({
  patientId: objectId,
  type: z.enum(ENCOUNTER_TYPES, { errorMap: () => ({ message: 'Select a visit type' }) }),
  departmentId: objectId,
  attendingDoctorId: optionalObjectId,
  chiefComplaint: optionalString(1000),
  diagnosis: z.array(diagnosisSchema).max(20).optional(),
  vitals: vitalsSchema.optional(),
  startedAt: optionalDate,
  notes: optionalString(4000),
});

export const updateEncounterSchema = z
  .object({
    departmentId: objectId.optional(),
    attendingDoctorId: optionalObjectId,
    chiefComplaint: optionalString(1000),
    diagnosis: z.array(diagnosisSchema).max(20).optional(),
    // `vitals` is deliberately absent: observations are a series, and updating
    // them in place overwrote the previous reading. Use POST /encounters/:id/vitals.
    notes: optionalString(4000),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

/** Close an OPD/daycare visit, or discharge an admitted one. */
export const closeEncounterSchema = z.object({
  dischargeSummary: optionalString(4000),
  dischargeType: z
    .enum(['recovered', 'referred', 'lama', 'transferred', 'deceased'])
    .optional(),
  endedAt: optionalDate,
});
