import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listTriageQuery,
  createTriageSchema,
  updateTriageSchema,
  assignTriageSchema,
  disposeTriageSchema,
} from '../validators/triageValidator.js';
import * as controller from '../controllers/triageController.js';

const router = Router();
router.use(requireAuth);

const ER = MODULES.TRIAGE;

router.get(
  '/',
  requirePermission(ER, 'view'),
  validate({ query: listTriageQuery }),
  controller.listTriage,
);

router.post(
  '/',
  requirePermission(ER, 'create'),
  validate({ body: createTriageSchema }),
  audit({ action: 'create', resourceType: 'Triage' }),
  controller.createTriage,
);

router.get(
  '/:id',
  requirePermission(ER, 'view'),
  validate({ params: idParam }),
  controller.getTriage,
);

router.patch(
  '/:id',
  requirePermission(ER, 'edit'),
  validate({ params: idParam, body: updateTriageSchema }),
  audit({ action: 'update', resourceType: 'Triage' }),
  controller.updateTriage,
);

router.post(
  '/:id/assign',
  requirePermission(ER, 'assign'),
  validate({ params: idParam, body: assignTriageSchema }),
  audit({ action: 'update', resourceType: 'Triage' }),
  controller.assignTriage,
);

router.post(
  '/:id/disposition',
  requirePermission(ER, 'edit'),
  validate({ params: idParam, body: disposeTriageSchema }),
  audit({ action: 'update', resourceType: 'Triage' }),
  controller.disposeTriage,
);

export default router;
