import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { dicomUpload } from '../middleware/upload.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import { listDicomQuery, instanceParam } from '../validators/dicomValidator.js';
import * as controller from '../controllers/dicomController.js';

const router = Router();
router.use(requireAuth);

const D = MODULES.DICOM;

router.get(
  '/studies',
  requirePermission(D, 'view'),
  validate({ query: listDicomQuery }),
  controller.listStudies,
);

router.post(
  '/studies',
  requirePermission(D, 'create'),
  dicomUpload.single('file'),
  audit({ action: 'create', resourceType: 'DicomStudy' }),
  controller.uploadInstance,
);

router.get(
  '/studies/:id',
  requirePermission(D, 'view'),
  validate({ params: idParam }),
  controller.getStudy,
);

router.get(
  '/studies/:id/instances/:instanceId',
  requirePermission(D, 'download'),
  validate({ params: instanceParam }),
  controller.downloadInstance,
);

export default router;
