import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listCasesQuery,
  createCaseSchema,
  updateCaseSchema,
  ancVisitSchema,
  listImmQuery,
  createImmSchema,
} from '../validators/tier23Validator.js';
import * as controller from '../controllers/maternityController.js';

const router = Router();
router.use(requireAuth);

router.get('/cases', requirePermission(MODULES.MATERNITY, 'view'), validate({ query: listCasesQuery }), controller.listCases);
router.post(
  '/cases',
  requirePermission(MODULES.MATERNITY, 'create'),
  validate({ body: createCaseSchema }),
  audit({ action: 'create', resourceType: 'MaternityCase' }),
  controller.createCase,
);
router.get('/cases/:id', requirePermission(MODULES.MATERNITY, 'view'), validate({ params: idParam }), controller.getCase);
router.patch(
  '/cases/:id',
  requirePermission(MODULES.MATERNITY, 'edit'),
  validate({ params: idParam, body: updateCaseSchema }),
  audit({ action: 'update', resourceType: 'MaternityCase' }),
  controller.updateCase,
);
router.post(
  '/cases/:id/visits',
  requirePermission(MODULES.MATERNITY, 'create'),
  validate({ params: idParam, body: ancVisitSchema }),
  audit({ action: 'create', resourceType: 'AncVisit' }),
  controller.addVisit,
);

router.get(
  '/immunizations',
  requirePermission(MODULES.IMMUNIZATIONS, 'view'),
  validate({ query: listImmQuery }),
  controller.listImmunizations,
);
router.post(
  '/immunizations',
  requirePermission(MODULES.IMMUNIZATIONS, 'create'),
  validate({ body: createImmSchema }),
  audit({ action: 'create', resourceType: 'Immunization' }),
  controller.recordImmunization,
);

export default router;
