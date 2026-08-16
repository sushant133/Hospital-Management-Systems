import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import { sendSmsSchema, listSmsQuery } from '../validators/nepalValidator.js';
import * as controller from '../controllers/smsController.js';

const router = Router();
router.use(requireAuth);

// Literal paths before `/:id` — Express matches in order.
router.get('/templates', requirePermission(MODULES.SMS, 'view'), controller.listTemplates);
router.get('/usage', requirePermission(MODULES.SMS, 'view'), controller.usageReport);

router.get(
  '/',
  requirePermission(MODULES.SMS, 'view'),
  validate({ query: listSmsQuery }),
  controller.listMessages,
);

/**
 * Sending is audited: an SMS goes to a patient's phone carrying their clinical
 * or financial information, so who sent what to whom is part of the record.
 */
router.post(
  '/',
  requirePermission(MODULES.SMS, 'send'),
  validate({ body: sendSmsSchema }),
  audit({ action: 'create', resourceType: 'SmsMessage' }),
  controller.send,
);
router.post(
  '/:id/resend',
  requirePermission(MODULES.SMS, 'resend'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'SmsMessage' }),
  controller.resend,
);

export default router;
