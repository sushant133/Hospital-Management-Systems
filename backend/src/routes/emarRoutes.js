import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { listAdministrationsQuery, recordAdministrationSchema } from '../validators/emarValidator.js';
import * as controller from '../controllers/emarController.js';

const router = Router();
router.use(requireAuth);

const MAR = MODULES.MEDICATION_ADMIN;

router.get(
  '/',
  requirePermission(MAR, 'view'),
  validate({ query: listAdministrationsQuery }),
  controller.listAdministrations,
);

router.post(
  '/',
  requirePermission(MAR, 'create'),
  validate({ body: recordAdministrationSchema }),
  audit({ action: 'administer', resourceType: 'MedicationAdministration' }),
  controller.recordAdministration,
);

export default router;
