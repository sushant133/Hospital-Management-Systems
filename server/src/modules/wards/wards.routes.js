import { Router } from 'express';
import requireAuth from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import validate from '../../middleware/validate.js';
import audit from '../../middleware/audit.js';
import { MODULES } from '../../config/permissions.js';
import { idParam } from '../../utils/commonSchemas.js';
import {
  listWardsQuery,
  createWardSchema,
  updateWardSchema,
  wardIdParam,
  bedIdParam,
  listBedsQuery,
  createBedSchema,
  createBedRangeSchema,
  updateBedSchema,
} from './wards.validation.js';
import * as controller from './wards.controller.js';

const router = Router();

router.use(requireAuth);

const WARDS = MODULES.WARDS;
const BEDS = MODULES.BEDS;

// --- Wards: read for all staff, write for admin ---
router.get(
  '/',
  requirePermission(WARDS, 'view'),
  validate({ query: listWardsQuery }),
  controller.listWards,
);

router.get(
  '/:id',
  requirePermission(WARDS, 'view'),
  validate({ params: idParam }),
  controller.getWard,
);

router.post(
  '/',
  requirePermission(WARDS, 'create'),
  validate({ body: createWardSchema }),
  audit({ action: 'create', resourceType: 'Ward' }),
  controller.createWard,
);

router.patch(
  '/:id',
  requirePermission(WARDS, 'edit'),
  validate({ params: idParam, body: updateWardSchema }),
  audit({ action: 'update', resourceType: 'Ward' }),
  controller.updateWard,
);

router.delete(
  '/:id',
  requirePermission(WARDS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Ward' }),
  controller.deleteWard,
);

router.patch(
  '/:id/restore',
  requirePermission(WARDS, 'restore'),
  validate({ params: idParam }),
  audit({ action: 'restore', resourceType: 'Ward' }),
  controller.restoreWard,
);

// --- Beds (nested under a ward) ---
router.get(
  '/:wardId/beds',
  requirePermission(BEDS, 'view'),
  validate({ params: wardIdParam, query: listBedsQuery }),
  controller.listBeds,
);

router.post(
  '/:wardId/beds',
  requirePermission(BEDS, 'create'),
  validate({ params: wardIdParam, body: createBedSchema }),
  audit({ action: 'create', resourceType: 'Bed' }),
  controller.createBed,
);

router.post(
  '/:wardId/beds/bulk',
  requirePermission(BEDS, 'create'),
  validate({ params: wardIdParam, body: createBedRangeSchema }),
  audit({ action: 'create', resourceType: 'Bed' }),
  controller.createBedRange,
);

/**
 * Nurses need this to flip a bed between cleaning / maintenance / available, so
 * the gate is `changeStatus` (which nurses hold) rather than `edit` (which they
 * do not). The controller rejects non-status fields for anyone without `edit` —
 * a nurse cannot reprice a bed through this route.
 */
router.patch(
  '/:wardId/beds/:bedId',
  requirePermission(BEDS, 'changeStatus'),
  validate({ params: bedIdParam, body: updateBedSchema }),
  audit({ action: 'update', resourceType: 'Bed' }),
  controller.updateBed,
);

router.delete(
  '/:wardId/beds/:bedId',
  requirePermission(BEDS, 'delete'),
  validate({ params: bedIdParam }),
  audit({ action: 'delete', resourceType: 'Bed' }),
  controller.deleteBed,
);

export default router;
