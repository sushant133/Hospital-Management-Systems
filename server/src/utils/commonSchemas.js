import { z } from 'zod';
import mongoose from 'mongoose';

/** A 24-char hex Mongo ObjectId. */
export const objectId = z
  .string()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'Must be a valid id' });

/** Optional ObjectId that also accepts '' / null and normalizes to null. */
export const optionalObjectId = z
  .union([objectId, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

/** `/:id` route param. */
export const idParam = z.object({ id: objectId });

/** Trimmed non-empty string with a max length. */
export const nonEmptyString = (max = 200, label = 'This field') =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`);

/** Trimmed optional string that normalizes '' to undefined. */
export const optionalString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v));

/** Loose international phone: digits, spaces, +, -, parentheses. */
export const phone = z
  .string()
  .trim()
  .min(6, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .regex(/^[+]?[\d\s()-]{6,20}$/, 'Phone number contains invalid characters');

export const optionalPhone = z
  .union([phone, z.literal('')])
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const email = z.string().trim().toLowerCase().email('Must be a valid email address');

export const optionalEmail = z
  .union([email, z.literal('')])
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/**
 * Password policy: 8+ chars with at least one lowercase, one uppercase and one
 * digit. Kept deliberately achievable — length matters more than symbol soup.
 */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number');

/** ISO date string or Date, coerced to a Date. */
export const dateField = z.coerce.date({ invalid_type_error: 'Must be a valid date' });

export const optionalDate = z
  .union([dateField, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

/** A date that must not be in the future (birth dates, procedure dates). */
export const pastDate = dateField.refine((d) => d <= new Date(), {
  message: 'Date cannot be in the future',
});

/** Standard list query: pagination + sorting + search + soft-delete opt-in. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().trim().default('-createdAt'),
  search: z.string().trim().max(120).optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

/** Extend the standard list query with module-specific filters. */
export const extendListQuery = (shape) => listQuery.extend(shape);
