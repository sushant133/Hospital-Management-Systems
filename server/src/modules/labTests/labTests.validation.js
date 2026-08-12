import { z } from 'zod';
import { SPECIMEN_TYPES, ANALYTE_VALUE_TYPES } from '../../models/LabTest.js';
import {
  objectId,
  optionalObjectId,
  nonEmptyString,
  optionalString,
  extendListQuery,
} from '../../utils/commonSchemas.js';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code must be at least 2 characters')
  .max(16, 'Code must be 16 characters or fewer')
  .regex(/^[A-Z0-9-]+$/, 'Code may contain only letters, numbers and hyphens');

const analyteSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'Analyte code is required')
      .max(16)
      .regex(/^[A-Z0-9-]+$/, 'Analyte code may contain only letters, numbers and hyphens'),
    name: nonEmptyString(120, 'Analyte name'),
    valueType: z.enum(ANALYTE_VALUE_TYPES).optional().default('numeric'),
    unit: optionalString(24),
    refLow: z.coerce.number().nullable().optional(),
    refHigh: z.coerce.number().nullable().optional(),
    criticalLow: z.coerce.number().nullable().optional(),
    criticalHigh: z.coerce.number().nullable().optional(),
    expectedValues: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
    normalValue: optionalString(60),
    displayOrder: z.coerce.number().int().min(0).optional().default(0),
  })
  // A range that reads low > high is a data-entry slip that would mis-flag
  // every result validated against it, so reject it at the boundary.
  .refine(
    (a) => a.refLow == null || a.refHigh == null || a.refLow <= a.refHigh,
    { message: 'Reference low must not exceed reference high', path: ['refLow'] },
  )
  .refine(
    (a) => a.criticalLow == null || a.refLow == null || a.criticalLow <= a.refLow,
    { message: 'Critical low must be at or below the reference low', path: ['criticalLow'] },
  )
  .refine(
    (a) => a.criticalHigh == null || a.refHigh == null || a.criticalHigh >= a.refHigh,
    { message: 'Critical high must be at or above the reference high', path: ['criticalHigh'] },
  );

export const listLabTestsQuery = extendListQuery({
  departmentId: optionalObjectId,
  category: optionalString(80),
  specimen: z.enum(SPECIMEN_TYPES).optional(),
});

export const createLabTestSchema = z.object({
  code,
  name: nonEmptyString(160, 'Test name'),
  description: optionalString(1000),
  departmentId: objectId,
  specimen: z.enum(SPECIMEN_TYPES).optional().default('blood'),
  category: optionalString(80),
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  turnaroundHours: z.coerce.number().min(0).max(2160).optional().default(24),
  preparationNotes: optionalString(1000),
  analytes: z.array(analyteSchema).min(1, 'Add at least one analyte').max(60),
});

export const updateLabTestSchema = z
  .object({
    code: code.optional(),
    name: nonEmptyString(160, 'Test name').optional(),
    description: optionalString(1000),
    departmentId: objectId.optional(),
    specimen: z.enum(SPECIMEN_TYPES).optional(),
    category: optionalString(80),
    price: z.coerce.number().min(0).optional(),
    turnaroundHours: z.coerce.number().min(0).max(2160).optional(),
    preparationNotes: optionalString(1000),
    analytes: z.array(analyteSchema).min(1).max(60).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
