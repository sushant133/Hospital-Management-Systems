import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { listResultsQuery } from '../validators/labOrderValidator.js';
import * as controller from '../controllers/labOrderController.js';

const router = Router();

router.use(requireAuth);

/**
 * Cross-order result search — the patient's lab timeline.
 * Broader read than the order worklist: any clinician reviewing a patient needs
 * it, and it is the query behind the "Lab results" tab on the patient record.
 */
router.get(
  '/',
  requirePermission(MODULES.LAB_RESULTS, 'view'),
  validate({ query: listResultsQuery }),
  controller.listLabResults,
);

export default router;
