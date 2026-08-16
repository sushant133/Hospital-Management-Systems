import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listUnitsQuery,
  createUnitSchema,
  listBloodReqQuery,
  createBloodReqSchema,
  crossmatchSchema,
} from '../validators/tier23Validator.js';
import * as controller from '../controllers/bloodBankController.js';

const router = Router();
router.use(requireAuth);
const BB = MODULES.BLOOD_BANK;

router.get('/units', requirePermission(BB, 'view'), validate({ query: listUnitsQuery }), controller.listUnits);
router.post(
  '/units',
  requirePermission(BB, 'manageUnits'),
  validate({ body: createUnitSchema }),
  audit({ action: 'create', resourceType: 'BloodUnit' }),
  controller.registerUnit,
);
router.post(
  '/units/:id/discard',
  requirePermission(BB, 'manageUnits'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'BloodUnit' }),
  controller.discardUnit,
);

router.get('/requests', requirePermission(BB, 'view'), validate({ query: listBloodReqQuery }), controller.listRequests);
router.post(
  '/requests',
  requirePermission(BB, 'request'),
  validate({ body: createBloodReqSchema }),
  audit({ action: 'create', resourceType: 'BloodRequest' }),
  controller.createRequest,
);
router.post(
  '/requests/:id/crossmatch',
  requirePermission(BB, 'crossmatch'),
  validate({ params: idParam, body: crossmatchSchema }),
  audit({ action: 'update', resourceType: 'BloodRequest' }),
  controller.crossmatch,
);
router.post(
  '/requests/:id/issue',
  requirePermission(BB, 'issue'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'BloodRequest' }),
  controller.issueUnits,
);

export default router;
