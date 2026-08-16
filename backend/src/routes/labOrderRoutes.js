import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import auditRead from '../middleware/auditRead.js';
import { MODULES } from '../config/permissions.js';
import { idParam, objectId } from '../utils/commonSchemas.js';
import {
  listLabOrdersQuery,
  createLabOrderSchema,
  collectSampleSchema,
  cancelLabOrderSchema,
  submitResultSchema,
  amendResultSchema,
} from '../validators/labOrderValidator.js';
import * as controller from '../controllers/labOrderController.js';

const router = Router();

router.use(requireAuth);

const ORDERS = MODULES.LAB_ORDERS;
const RESULTS = MODULES.LAB_RESULTS;

const resultIdParam = z.object({ id: objectId, resultId: objectId });

// --- Orders ---
router.get(
  '/',
  requirePermission(ORDERS, 'view'),
  validate({ query: listLabOrdersQuery }),
  controller.listLabOrders,
);

router.get(
  '/:id',
  requirePermission(ORDERS, 'view'),
  validate({ params: idParam }),
  auditRead({ resourceType: 'LabOrder' }),
  controller.getLabOrder,
);

// Doctors order; nurses may place an order on a named doctor's behalf.
// Ordering raises a charge, so this is a financial write as well as a clinical one.
router.post(
  '/',
  requirePermission(ORDERS, 'create'),
  validate({ body: createLabOrderSchema }),
  audit({ action: 'create', resourceType: 'LabOrder' }),
  controller.createLabOrder,
);

// --- Sample tracking (bench staff; nurses often draw the sample) ---
router.post(
  '/:id/collect',
  requirePermission(ORDERS, 'collect'),
  validate({ params: idParam, body: collectSampleSchema }),
  audit({ action: 'update', resourceType: 'LabOrder' }),
  controller.collectSample,
);

router.post(
  '/:id/start',
  requirePermission(ORDERS, 'process'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'LabOrder' }),
  controller.startProcessing,
);

// Cancelling reverses the charge — always audited.
router.post(
  '/:id/cancel',
  requirePermission(ORDERS, 'cancel'),
  validate({ params: idParam, body: cancelLabOrderSchema }),
  audit({ action: 'cancel', resourceType: 'LabOrder' }),
  controller.cancelLabOrder,
);

// --- Results ---
router.post(
  '/:id/results',
  requirePermission(RESULTS, 'create'),
  validate({ params: idParam, body: submitResultSchema }),
  audit({ action: 'create', resourceType: 'LabResult' }),
  controller.submitResult,
);

router.post(
  '/:id/results/:resultId/amend',
  requirePermission(RESULTS, 'amend'),
  validate({ params: resultIdParam, body: amendResultSchema }),
  audit({ action: 'amend', resourceType: 'LabResult' }),
  controller.amendResult,
);

// --- Report ---
router.get(
  '/:id/report',
  requirePermission(ORDERS, 'downloadReport'),
  validate({ params: idParam }),
  controller.downloadReport,
);

router.post(
  '/:id/report',
  requirePermission(ORDERS, 'process'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'LabOrder' }),
  controller.regenerateReport,
);

router.delete(
  '/:id',
  requirePermission(ORDERS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'LabOrder' }),
  controller.deleteLabOrder,
);

export default router;
