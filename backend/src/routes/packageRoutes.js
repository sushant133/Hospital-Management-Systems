import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listPackagesQuery,
  createPackageSchema,
  updatePackageSchema,
  applyPackageSchema,
} from '../validators/packageValidator.js';
import * as controller from '../controllers/packageController.js';

const router = Router();
router.use(requireAuth);

const PKG = MODULES.BILLING_PACKAGES;

router.get(
  '/',
  requirePermission(PKG, 'view'),
  validate({ query: listPackagesQuery }),
  controller.listPackages,
);

router.post(
  '/',
  requirePermission(PKG, 'create'),
  validate({ body: createPackageSchema }),
  audit({ action: 'create', resourceType: 'BillingPackage' }),
  controller.createPackage,
);

router.get(
  '/:id',
  requirePermission(PKG, 'view'),
  validate({ params: idParam }),
  controller.getPackage,
);

router.patch(
  '/:id',
  requirePermission(PKG, 'edit'),
  validate({ params: idParam, body: updatePackageSchema }),
  audit({ action: 'update', resourceType: 'BillingPackage' }),
  controller.updatePackage,
);

router.delete(
  '/:id',
  requirePermission(PKG, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'BillingPackage' }),
  controller.deletePackage,
);

router.post(
  '/:id/apply',
  requirePermission(PKG, 'apply'),
  validate({ params: idParam, body: applyPackageSchema }),
  audit({ action: 'create', resourceType: 'BillingLineItem' }),
  controller.applyPackage,
);

export default router;
