import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listUsersQuery,
  directoryQuery,
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
} from '../validators/userValidator.js';
import * as controller from '../controllers/userController.js';

const router = Router();

router.use(requireAuth);

const STAFF = MODULES.STAFF;

/**
 * The staff directory — names, roles and specialisations only.
 *
 * Declared before '/' so it is not shadowed, and gated on `viewDirectory`
 * rather than `view`: assigning work to a colleague (booking with a doctor,
 * naming the ordering clinician) requires knowing who they are, but not their
 * employment record. `listUsers` stays admin-only.
 */
router.get(
  '/directory',
  requirePermission(STAFF, 'viewDirectory'),
  validate({ query: directoryQuery }),
  controller.listDirectory,
);

router.get(
  '/',
  requirePermission(STAFF, 'view'),
  validate({ query: listUsersQuery }),
  controller.listUsers,
);

router.post(
  '/',
  requirePermission(STAFF, 'create'),
  validate({ body: createUserSchema }),
  audit({ action: 'create', resourceType: 'User' }),
  controller.createUser,
);

router.get(
  '/:id',
  requirePermission(STAFF, 'view'),
  validate({ params: idParam }),
  controller.getUser,
);

router.patch(
  '/:id',
  requirePermission(STAFF, 'edit'),
  validate({ params: idParam, body: updateUserSchema }),
  audit({ action: 'update', resourceType: 'User' }),
  controller.updateUser,
);

router.delete(
  '/:id',
  requirePermission(STAFF, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'User' }),
  controller.deactivateUser,
);

router.patch(
  '/:id/restore',
  requirePermission(STAFF, 'restore'),
  validate({ params: idParam }),
  audit({ action: 'restore', resourceType: 'User' }),
  controller.restoreUser,
);

router.post(
  '/:id/reset-password',
  requirePermission(STAFF, 'resetPassword'),
  validate({ params: idParam, body: resetPasswordSchema }),
  audit({ action: 'password_reset', resourceType: 'User' }),
  controller.resetPassword,
);

export default router;
