import { z } from 'zod';
import { objectId, optionalObjectId, optionalString, optionalDate, extendListQuery } from '../utils/commonSchemas.js';
import { MAR_STATUSES } from '../models/MedicationAdministration.js';

export const listAdministrationsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  prescriptionId: optionalObjectId,
  status: z.enum(MAR_STATUSES).optional(),
});

export const recordAdministrationSchema = z.object({
  prescriptionId: objectId,
  prescriptionItemId: objectId,
  status: z.enum(MAR_STATUSES, { errorMap: () => ({ message: 'Choose given, held, refused or missed' }) }),
  dose: optionalString(80),
  route: optionalString(40),
  scheduledAt: optionalDate,
  administeredAt: optionalDate,
  reason: optionalString(500),
  overrideReason: optionalString(500),
  notes: optionalString(1000),
});
