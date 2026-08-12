import { Router } from 'express';
import requireAuth from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import validate from '../../middleware/validate.js';
import audit from '../../middleware/audit.js';
import { MODULES } from '../../config/permissions.js';
import { idParam } from '../../utils/commonSchemas.js';
import {
  listDepartmentsQuery,
  createDepartmentSchema,
  updateDepartmentSchema,
} from './departments.validation.js';
import * as controller from './departments.controller.js';

const router = Router();

router.use(requireAuth);

const DEPARTMENTS = MODULES.DEPARTMENTS;

// Reference data: every authenticated role may read it (needed to populate
// dropdowns when creating encounters, orders, staff, etc.).
router.get(
  '/',
  requirePermission(DEPARTMENTS, 'view'),
  validate({ query: listDepartmentsQuery }),
  controller.listDepartments,
);

router.get(
  '/:id',
  requirePermission(DEPARTMENTS, 'view'),
  validate({ params: idParam }),
  controller.getDepartment,
);

// Configuration changes are audited too — a department rename shifts how
// revenue and workload reports read historically.
router.post(
  '/',
  requirePermission(DEPARTMENTS, 'create'),
  validate({ body: createDepartmentSchema }),
  audit({ action: 'create', resourceType: 'Department' }),
  controller.createDepartment,
);

router.patch(
  '/:id',
  requirePermission(DEPARTMENTS, 'edit'),
  validate({ params: idParam, body: updateDepartmentSchema }),
  audit({ action: 'update', resourceType: 'Department' }),
  controller.updateDepartment,
);

router.delete(
  '/:id',
  requirePermission(DEPARTMENTS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Department' }),
  controller.deleteDepartment,
);

router.patch(
  '/:id/restore',
  requirePermission(DEPARTMENTS, 'restore'),
  validate({ params: idParam }),
  audit({ action: 'restore', resourceType: 'Department' }),
  controller.restoreDepartment,
);

export default router;
