import { z } from 'zod';
import { email, password } from '../../utils/commonSchemas.js';

export const loginSchema = z.object({
  email,
  // Deliberately NOT the strict password policy — an existing account created
  // before a policy change must still be able to sign in.
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: password,
    confirmPassword: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
