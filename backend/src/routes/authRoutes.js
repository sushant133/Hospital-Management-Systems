import { Router } from 'express';
import validate from '../middleware/validateRequest.js';
import requireAuth from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';
import { loginSchema, changePasswordSchema } from '../validators/authValidator.js';
import * as controller from '../controllers/authController.js';

const router = Router();

// --- Public ---
router.post('/login', loginRateLimit, validate({ body: loginSchema }), controller.login);
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
