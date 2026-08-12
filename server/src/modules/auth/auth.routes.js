import { Router } from 'express';
import validate from '../../middleware/validate.js';
import requireAuth from '../../middleware/auth.js';
import { loginSchema, changePasswordSchema } from './auth.validation.js';
import * as controller from './auth.controller.js';

const router = Router();

// --- Public ---
router.post('/login', validate({ body: loginSchema }), controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);

// --- Authenticated (any role) ---
router.get('/me', requireAuth, controller.me);
router.post(
  '/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);

export default router;
