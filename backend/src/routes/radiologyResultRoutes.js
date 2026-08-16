import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { listRadiologyResultsQuery } from '../validators/radiologyOrderValidator.js';
import * as controller from '../controllers/radiologyOrderController.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  requirePermission(MODULES.RADIOLOGY_RESULTS, 'view'),
  validate({ query: listRadiologyResultsQuery }),
  controller.listRadiologyResults,
);

export default router;
