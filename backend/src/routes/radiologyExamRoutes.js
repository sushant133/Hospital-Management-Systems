import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listRadiologyExamsQuery,
  createRadiologyExamSchema,
  updateRadiologyExamSchema,
} from '../validators/radiologyExamValidator.js';
import * as controller from '../controllers/radiologyExamController.js';

const router = Router();

router.use(requireAuth);

const EXAMS = MODULES.RADIOLOGY_EXAMS;

router.get(
  '/',
  requirePermission(EXAMS, 'view'),
  validate({ query: listRadiologyExamsQuery }),
  controller.listRadiologyExams,
);

router.get(
  '/:id',
  requirePermission(EXAMS, 'view'),
  validate({ params: idParam }),
  controller.getRadiologyExam,
);

router.post(
  '/',
  requirePermission(EXAMS, 'create'),
  validate({ body: createRadiologyExamSchema }),
  audit({ action: 'create', resourceType: 'RadiologyExam' }),
  controller.createRadiologyExam,
);

router.patch(
  '/:id',
  requirePermission(EXAMS, 'edit'),
  validate({ params: idParam, body: updateRadiologyExamSchema }),
  audit({ action: 'update', resourceType: 'RadiologyExam' }),
  controller.updateRadiologyExam,
);

router.delete(
  '/:id',
  requirePermission(EXAMS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'RadiologyExam' }),
  controller.deleteRadiologyExam,
);

router.patch(
  '/:id/restore',
  requirePermission(EXAMS, 'restore'),
  validate({ params: idParam }),
  audit({ action: 'restore', resourceType: 'RadiologyExam' }),
  controller.restoreRadiologyExam,
);

export default router;
