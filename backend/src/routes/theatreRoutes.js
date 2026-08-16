import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listSurgeriesQuery,
  createSurgerySchema,
  updateSurgerySchema,
  completeSurgerySchema,
  cancelSurgerySchema,
} from '../validators/theatreValidator.js';
import * as controller from '../controllers/theatreController.js';

const router = Router();
router.use(requireAuth);

const OT = MODULES.THEATRE;

router.get(
  '/',
  requirePermission(OT, 'view'),
  validate({ query: listSurgeriesQuery }),
  controller.listSurgeries,
);

router.post(
  '/',
  requirePermission(OT, 'create'),
  validate({ body: createSurgerySchema }),
  audit({ action: 'create', resourceType: 'Surgery' }),
  controller.createSurgery,
);

router.get(
  '/:id',
  requirePermission(OT, 'view'),
  validate({ params: idParam }),
  controller.getSurgery,
);

router.patch(
  '/:id',
  requirePermission(OT, 'edit'),
  validate({ params: idParam, body: updateSurgerySchema }),
  audit({ action: 'update', resourceType: 'Surgery' }),
  controller.updateSurgery,
);

router.post(
  '/:id/start',
  requirePermission(OT, 'start'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Surgery' }),
  controller.startSurgery,
);

router.post(
  '/:id/complete',
  requirePermission(OT, 'complete'),
  validate({ params: idParam, body: completeSurgerySchema }),
  audit({ action: 'update', resourceType: 'Surgery' }),
  controller.completeSurgery,
);

router.post(
  '/:id/cancel',
  requirePermission(OT, 'cancel'),
  validate({ params: idParam, body: cancelSurgerySchema }),
  audit({ action: 'cancel', resourceType: 'Surgery' }),
  controller.cancelSurgery,
);

export default router;
