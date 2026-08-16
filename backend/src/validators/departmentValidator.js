import { z } from 'zod';
import {
  nonEmptyString,
  optionalString,
  optionalPhone,
  optionalObjectId,
  extendListQuery,
} from '../utils/commonSchemas.js';

export const listDepartmentsQuery = extendListQuery({});

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code must be at least 2 characters')
  .max(12, 'Code must be 12 characters or fewer')
  .regex(/^[A-Z0-9-]+$/, 'Code may contain only letters, numbers and hyphens');

export const createDepartmentSchema = z.object({
  code,
  name: nonEmptyString(120, 'Department name'),
  description: optionalString(1000),
  headOfDepartmentId: optionalObjectId,
  floor: optionalString(40),
  phone: optionalPhone,
  extension: optionalString(12),
});

export const updateDepartmentSchema = z
  .object({
    code: code.optional(),
    name: nonEmptyString(120, 'Department name').optional(),
    description: optionalString(1000),
    headOfDepartmentId: optionalObjectId,
    floor: optionalString(40),
    phone: optionalPhone,
    extension: optionalString(12),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
