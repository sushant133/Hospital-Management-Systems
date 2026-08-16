import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { listAdmissionsQuery, occupancyQuery } from '../validators/admissionValidator.js';
import * as controller from '../controllers/admissionController.js';

const router = Router();

router.use(requireAuth);

/**
 * Read-only views of the ward. The actions that change an admission live on
 * /encounters/:id, because an admission is a state of an encounter rather than
 * a record of its own.
 */

/**
 * The bed board. Gated on `beds.view` (every role) rather than on encounters —
 * it reports capacity, not patients, so porters and domestic staff can see it.
 */
router.get(
  '/occupancy',
  requirePermission(MODULES.BEDS, 'view'),
  validate({ query: occupancyQuery }),
  controller.getOccupancy,
);

/** Who is in a bed right now. This one does name patients. */
router.get(
  '/',
  requirePermission(MODULES.ENCOUNTERS, 'view'),
  validate({ query: listAdmissionsQuery }),
  controller.listAdmissions,
);

export default router;
