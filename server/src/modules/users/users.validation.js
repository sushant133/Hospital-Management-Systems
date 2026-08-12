import { z } from 'zod';
import { ROLE_VALUES } from '../../config/index.js';
import {
  email,
  password,
  phone,
  optionalString,
  optionalObjectId,
  nonEmptyString,
  extendListQuery,
} from '../../utils/commonSchemas.js';

export const listUsersQuery = extendListQuery({
  role: z.enum(ROLE_VALUES).optional(),
  departmentId: optionalObjectId,
});

export const createUserSchema = z.object({
  email,
  password,
  firstName: nonEmptyString(80, 'First name'),
  lastName: nonEmptyString(80, 'Last name'),
  phone: phone.optional(),
  role: z.enum(ROLE_VALUES, { errorMap: () => ({ message: 'Select a valid role' }) }),
  departmentId: optionalObjectId,
  specialization: optionalString(120),
  licenseNumber: optionalString(80),
  mustChangePassword: z.boolean().optional().default(true),
});

/**
 * Update deliberately omits `password` (use /reset-password), `role` changes
 * are allowed but `isActive` is not — deactivation goes through DELETE so the
 * soft-delete audit fields are always populated.
 */
export const updateUserSchema = z
  .object({
    email: email.optional(),
    firstName: nonEmptyString(80, 'First name').optional(),
    lastName: nonEmptyString(80, 'Last name').optional(),
    phone: phone.optional(),
    role: z.enum(ROLE_VALUES).optional(),
    departmentId: optionalObjectId,
    specialization: optionalString(120),
    licenseNumber: optionalString(80),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const resetPasswordSchema = z.object({
  newPassword: password,
  mustChangePassword: z.boolean().optional().default(true),
});
