import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  generateReturnSchema,
  reviewReturnSchema,
  listReturnsQuery,
} from '../validators/nepalValidator.js';
import * as controller from '../controllers/hmisController.js';

/**
 * Statutory HMIS / DHIS2 returns (A9).
 *
 * Every state change is audited, and the approval and submission steps
 * especially: a figure sent to the Ministry goes over a named person's
 * authority, and MoHP comes back to that person about it months later.
 */
const router = Router();
router.use(requireAuth);

// Literal paths first — `/:id` would otherwise swallow them.
router.get('/indicators', requirePermission(MODULES.HMIS, 'view'), controller.listIndicators);
router.get('/outstanding', requirePermission(MODULES.HMIS, 'view'), controller.outstandingPeriods);

router.get(
  '/',
  requirePermission(MODULES.HMIS, 'view'),
  validate({ query: listReturnsQuery }),
  controller.listReturns,
);
router.post(
  '/generate',
  requirePermission(MODULES.HMIS, 'generate'),
  validate({ body: generateReturnSchema }),
  audit({ action: 'create', resourceType: 'HmisReturn' }),
  controller.generate,
);

router.get(
  '/:id',
  requirePermission(MODULES.HMIS, 'view'),
  validate({ params: idParam }),
  controller.getReturn,
);
router.get(
  '/:id/export/dhis2',
  requirePermission(MODULES.HMIS, 'view'),
  validate({ params: idParam }),
  controller.exportDhis2,
);
router.post(
  '/:id/review',
  requirePermission(MODULES.HMIS, 'review'),
  validate({ params: idParam, body: reviewReturnSchema }),
  audit({ action: 'update', resourceType: 'HmisReturn' }),
  controller.review,
);
router.post(
  '/:id/approve',
  requirePermission(MODULES.HMIS, 'approve'),
  validate({ params: idParam }),
  audit({ action: 'approve', resourceType: 'HmisReturn' }),
  controller.approve,
);
router.post(
  '/:id/submit',
  requirePermission(MODULES.HMIS, 'submit'),
  validate({ params: idParam }),
  audit({ action: 'submit', resourceType: 'HmisReturn' }),
  controller.submit,
);
router.post(
  '/:id/submit/manual',
  requirePermission(MODULES.HMIS, 'submit'),
  validate({ params: idParam }),
  audit({ action: 'submit', resourceType: 'HmisReturn' }),
  controller.markSubmittedManually,
);

export default router;
