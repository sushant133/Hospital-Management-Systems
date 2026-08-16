import { z } from 'zod';
import { MODALITIES } from '../models/RadiologyExam.js';
import {
  objectId,
  optionalObjectId,
  nonEmptyString,
  optionalString,
  extendListQuery,
} from '../utils/commonSchemas.js';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code must be at least 2 characters')
  .max(16, 'Code must be 16 characters or fewer')
  .regex(/^[A-Z0-9-]+$/, 'Code may contain only letters, numbers and hyphens');

export const listRadiologyExamsQuery = extendListQuery({
  departmentId: optionalObjectId,
  modality: z.enum(MODALITIES).optional(),
  bodyPart: optionalString(80),
});

export const createRadiologyExamSchema = z.object({
  code,
  name: nonEmptyString(160, 'Exam name'),
  description: optionalString(1000),
  modality: z.enum(MODALITIES),
  bodyPart: nonEmptyString(80, 'Body part'),
  departmentId: objectId,
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional().default(15),
  contrastRequired: z.boolean().optional().default(false),
  typicalDoseMsv: z.coerce.number().min(0).optional().default(0),
  preparationNotes: optionalString(1000),
});

export const updateRadiologyExamSchema = z
  .object({
    code: code.optional(),
    name: nonEmptyString(160, 'Exam name').optional(),
    description: optionalString(1000),
    modality: z.enum(MODALITIES).optional(),
    bodyPart: nonEmptyString(80, 'Body part').optional(),
    departmentId: objectId.optional(),
    price: z.coerce.number().min(0).optional(),
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
    contrastRequired: z.boolean().optional(),
    typicalDoseMsv: z.coerce.number().min(0).optional(),
    preparationNotes: optionalString(1000),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
