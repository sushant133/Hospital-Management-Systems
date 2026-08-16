import { z } from 'zod';
import { objectId, optionalObjectId, optionalString, extendListQuery } from '../utils/commonSchemas.js';

export const listDicomQuery = extendListQuery({
  patientId: optionalObjectId,
  radiologyOrderId: optionalObjectId,
  modality: optionalString(20),
  accessionNumber: optionalString(40),
});

export const uploadDicomFields = z.object({
  patientId: optionalObjectId,
  radiologyOrderId: optionalObjectId,
});

export const instanceParam = z.object({
  id: objectId,
  instanceId: objectId,
});
