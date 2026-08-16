import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  nonEmptyString,
  extendListQuery,
} from '../utils/commonSchemas.js';

const packageItemSchema = z.object({
  itemCode: nonEmptyString(40, 'Item code'),
  description: nonEmptyString(240, 'Description'),
  quantity: z.coerce.number().min(0.01).default(1),
  unitPrice: z.coerce.number().min(0),
  taxPercent: z.coerce.number().min(0).max(100).optional().default(0),
  taxCode: optionalString(20),
  sourceType: z
    .enum(['consultation', 'procedure', 'lab', 'radiology', 'pharmacy', 'other'])
    .optional()
    .default('procedure'),
});

export const listPackagesQuery = extendListQuery({
  departmentId: optionalObjectId,
});

export const createPackageSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  name: nonEmptyString(160, 'Package name'),
  description: optionalString(1000),
  departmentId: optionalObjectId,
  items: z.array(packageItemSchema).min(1, 'A package needs at least one item').max(50),
});

export const updatePackageSchema = createPackageSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const applyPackageSchema = z.object({
  encounterId: objectId,
});
