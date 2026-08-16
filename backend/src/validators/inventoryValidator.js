import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  nonEmptyString,
  extendListQuery,
} from '../utils/commonSchemas.js';
import { INVENTORY_CATEGORIES, TRANSACTION_TYPES } from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

const itemCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Item code is too short')
  .max(24, 'Item code is too long')
  .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only');

export const listItemsQuery = extendListQuery({
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  isAsset: booleanFlag,
  location: optionalString(120),
  lowStockOnly: booleanFlag,
});

export const createItemSchema = z.object({
  itemCode,
  name: nonEmptyString(160, 'Item name'),
  description: optionalString(1000),
  category: z.enum(INVENTORY_CATEGORIES).optional().default('consumable'),
  unit: nonEmptyString(24, 'Unit'),
  reorderLevel: z.coerce.number().int().min(0).optional().default(0),
  unitCost: z.coerce.number().min(0).optional().default(0),
  location: optionalString(120),
  isAsset: z.boolean().optional().default(false),
  supplier: optionalString(160),
  notes: optionalString(1000),
  // `quantityOnHand` is deliberately absent: stock arrives through a receipt,
  // never by typing a number into the item record.
});

export const updateItemSchema = createItemSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

/**
 * One schema for all four movement types, with the conditional requirements
 * each one carries.
 */
export const recordTransactionSchema = z
  .object({
    itemId: objectId,
    type: z.enum(TRANSACTION_TYPES, {
      errorMap: () => ({ message: 'Choose receipt, issue, adjustment or return' }),
    }),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
    /** Adjustments only — a stock count can correct in either direction. */
    direction: z.enum(['increase', 'decrease']).optional(),
    departmentId: optionalObjectId,
    reference: optionalString(120),
    reason: optionalString(500),
    occurredAt: optionalDate,
  })
  .refine((value) => !['issue', 'return'].includes(value.type) || Boolean(value.departmentId), {
    message: 'Name the department the stock is going to or coming back from',
    path: ['departmentId'],
  })
  .refine((value) => value.type !== 'adjustment' || Boolean(value.direction), {
    message: 'Say whether the adjustment increases or decreases stock',
    path: ['direction'],
  })
  .refine(
    (value) => value.type !== 'adjustment' || (value.reason ?? '').trim().length >= 5,
    {
      message: 'An adjustment needs a reason of at least 5 characters',
      path: ['reason'],
    },
  );

export const listTransactionsQuery = extendListQuery({
  itemId: optionalObjectId,
  departmentId: optionalObjectId,
  type: z.enum(TRANSACTION_TYPES).optional(),
  from: optionalDate,
  to: optionalDate,
});

export const consumptionQuery = z.object({
  from: optionalDate,
  to: optionalDate,
  itemId: optionalObjectId,
});
