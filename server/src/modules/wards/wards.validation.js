import { z } from 'zod';
import { WARD_TYPES } from '../../models/Ward.js';
import { BED_STATUSES } from '../../models/Bed.js';
import {
  objectId,
  nonEmptyString,
  optionalString,
  optionalObjectId,
  extendListQuery,
} from '../../utils/commonSchemas.js';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code must be at least 2 characters')
  .max(12, 'Code must be 12 characters or fewer')
  .regex(/^[A-Z0-9-]+$/, 'Code may contain only letters, numbers and hyphens');

export const listWardsQuery = extendListQuery({
  departmentId: optionalObjectId,
  type: z.enum(WARD_TYPES).optional(),
});

export const createWardSchema = z.object({
  code,
  name: nonEmptyString(120, 'Ward name'),
  departmentId: objectId,
  type: z.enum(WARD_TYPES).optional().default('general'),
  gender: z.enum(['male', 'female', 'mixed']).optional().default('mixed'),
  floor: optionalString(40),
  inChargeId: optionalObjectId,
});

export const updateWardSchema = z
  .object({
    code: code.optional(),
    name: nonEmptyString(120, 'Ward name').optional(),
    departmentId: objectId.optional(),
    type: z.enum(WARD_TYPES).optional(),
    gender: z.enum(['male', 'female', 'mixed']).optional(),
    floor: optionalString(40),
    inChargeId: optionalObjectId,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

// --- Beds ---

export const wardIdParam = z.object({ wardId: objectId });
export const bedIdParam = z.object({ wardId: objectId, bedId: objectId });

export const listBedsQuery = z.object({
  status: z.enum(BED_STATUSES).optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const createBedSchema = z.object({
  bedNumber: nonEmptyString(20, 'Bed number'),
  status: z.enum(BED_STATUSES).optional().default('available'),
  dailyRate: z.coerce.number().min(0, 'Daily rate cannot be negative').optional().default(0),
  notes: optionalString(500),
});

/** Bulk-create a numbered range, e.g. prefix "B" from 1..20 -> B1 .. B20. */
export const createBedRangeSchema = z
  .object({
    prefix: z.string().trim().max(10).optional().default(''),
    from: z.coerce.number().int().min(1),
    to: z.coerce.number().int().min(1).max(9999),
    dailyRate: z.coerce.number().min(0).optional().default(0),
  })
  .refine((d) => d.to >= d.from, { message: '"to" must be greater than or equal to "from"', path: ['to'] })
  .refine((d) => d.to - d.from < 200, { message: 'Create at most 200 beds at a time', path: ['to'] });

export const updateBedSchema = z
  .object({
    bedNumber: nonEmptyString(20, 'Bed number').optional(),
    status: z.enum(BED_STATUSES).optional(),
    dailyRate: z.coerce.number().min(0).optional(),
    notes: optionalString(500),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
