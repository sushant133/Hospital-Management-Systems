import { Router } from 'express';
import requireAuth from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import validate from '../../middleware/validate.js';
import audit from '../../middleware/audit.js';
import { MODULES } from '../../config/permissions.js';
import { idParam } from '../../utils/commonSchemas.js';
import {
  listLabTestsQuery,
  createLabTestSchema,
  updateLabTestSchema,
} from './labTests.validation.js';
import * as controller from './labTests.controller.js';

const router = Router();

router.use(requireAuth);

const LAB_TESTS = MODULES.LAB_TESTS;

router.get(
  '/',
  requirePermission(LAB_TESTS, 'view'),
  validate({ query: listLabTestsQuery }),
  controller.listLabTests,
);

router.get(
  '/:id',
  requirePermission(LAB_TESTS, 'view'),
  validate({ params: idParam }),
  controller.getLabTest,
);

// The catalogue is priced reference data: a change here changes what patients
// are billed, so every write is audited.
router.post(
  '/',
  requirePermission(LAB_TESTS, 'create'),
  validate({ body: createLabTestSchema }),
  audit({ action: 'create', resourceType: 'LabTest' }),
  controller.createLabTest,
);

router.patch(
  '/:id',
  requirePermission(LAB_TESTS, 'edit'),
  validate({ params: idParam, body: updateLabTestSchema }),
  audit({ action: 'update', resourceType: 'LabTest' }),
  controller.updateLabTest,
);

router.delete(
  '/:id',
  requirePermission(LAB_TESTS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'LabTest' }),
  controller.deleteLabTest,
);

router.patch(
  '/:id/restore',
  requirePermission(LAB_TESTS, 'restore'),
  validate({ params: idParam }),
  audit({ action: 'restore', resourceType: 'LabTest' }),
  controller.restoreLabTest,
);

export default router;
