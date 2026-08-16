import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import auditRead from '../middleware/auditRead.js';
import { radiologyImageUpload } from '../middleware/upload.js';
import { MODULES } from '../config/permissions.js';
import { idParam, objectId } from '../utils/commonSchemas.js';
import {
  listRadiologyOrdersQuery,
  createRadiologyOrderSchema,
  scheduleOrderSchema,
  startStudySchema,
  cancelRadiologyOrderSchema,
  submitRadiologyResultSchema,
  amendRadiologyResultSchema,
} from '../validators/radiologyOrderValidator.js';
import * as controller from '../controllers/radiologyOrderController.js';

const router = Router();

router.use(requireAuth);

const ORDERS = MODULES.RADIOLOGY_ORDERS;
const RESULTS = MODULES.RADIOLOGY_RESULTS;

const attachmentParam = z.object({ id: objectId, attachmentId: objectId });

router.get(
  '/',
  requirePermission(ORDERS, 'view'),
  validate({ query: listRadiologyOrdersQuery }),
  controller.listRadiologyOrders,
);

router.get(
  '/:id',
  requirePermission(ORDERS, 'view'),
  validate({ params: idParam }),
  auditRead({ resourceType: 'RadiologyOrder' }),
  controller.getRadiologyOrder,
);

router.post(
  '/',
  requirePermission(ORDERS, 'create'),
  validate({ body: createRadiologyOrderSchema }),
  audit({ action: 'create', resourceType: 'RadiologyOrder' }),
  controller.createRadiologyOrder,
);

router.post(
  '/:id/schedule',
  requirePermission(ORDERS, 'schedule'),
  validate({ params: idParam, body: scheduleOrderSchema }),
  audit({ action: 'update', resourceType: 'RadiologyOrder' }),
  controller.scheduleOrder,
);

router.post(
  '/:id/start',
  requirePermission(ORDERS, 'edit'),
  validate({ params: idParam, body: startStudySchema }),
  audit({ action: 'update', resourceType: 'RadiologyOrder' }),
  controller.startStudy,
);

router.post(
  '/:id/cancel',
  requirePermission(ORDERS, 'cancel'),
  validate({ params: idParam, body: cancelRadiologyOrderSchema }),
  audit({ action: 'cancel', resourceType: 'RadiologyOrder' }),
  controller.cancelRadiologyOrder,
);

router.post(
  '/:id/result',
  requirePermission(RESULTS, 'create'),
  validate({ params: idParam, body: submitRadiologyResultSchema }),
  audit({ action: 'create', resourceType: 'RadiologyResult' }),
  controller.submitResult,
);

router.post(
  '/:id/result/amend',
  requirePermission(RESULTS, 'amend'),
  validate({ params: idParam, body: amendRadiologyResultSchema }),
  audit({ action: 'amend', resourceType: 'RadiologyResult' }),
  controller.amendResult,
);

router.post(
  '/:id/attachments',
  requirePermission(RESULTS, 'attachImages'),
  validate({ params: idParam }),
  radiologyImageUpload.array('files', 8),
  audit({ action: 'update', resourceType: 'RadiologyResult' }),
  controller.attachImages,
);

router.get(
  '/:id/attachments/:attachmentId',
  requirePermission(RESULTS, 'view'),
  validate({ params: attachmentParam }),
  controller.downloadAttachment,
);

router.delete(
  '/:id/attachments/:attachmentId',
  requirePermission(RESULTS, 'attachImages'),
  validate({ params: attachmentParam }),
  audit({ action: 'update', resourceType: 'RadiologyResult' }),
  controller.removeAttachment,
);

router.get(
  '/:id/report',
  requirePermission(ORDERS, 'downloadReport'),
  validate({ params: idParam }),
  controller.downloadReport,
);

router.post(
  '/:id/report',
  requirePermission(ORDERS, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'RadiologyOrder' }),
  controller.regenerateReport,
);

router.delete(
  '/:id',
  requirePermission(ORDERS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'RadiologyOrder' }),
  controller.deleteRadiologyOrder,
);

export default router;
