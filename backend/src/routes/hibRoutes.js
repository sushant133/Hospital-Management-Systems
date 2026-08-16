import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  createHouseholdSchema,
  updateHouseholdSchema,
  linkMemberSchema,
  hibEligibilityQuery,
  listHouseholdsQuery,
} from '../validators/nepalValidator.js';
import * as controller from '../controllers/hibController.js';

/**
 * Health Insurance Board household policies (A6).
 *
 * `/eligibility` sits before `/:id` in the table below on purpose — Express
 * matches in order, and a literal path declared after a parameterised one is
 * unreachable because `:id` swallows it.
 */
const router = Router();
router.use(requireAuth);

/* --- Checks. Reads, so they can be called as often as the counter needs. -- */
router.get(
  '/eligibility',
  requirePermission(MODULES.HIB, 'checkEligibility'),
  validate({ query: hibEligibilityQuery }),
  controller.checkEligibility,
);
router.get(
  '/quote',
  requirePermission(MODULES.HIB, 'checkEligibility'),
  controller.quote,
);
router.get('/expiring', requirePermission(MODULES.HIB, 'view'), controller.expiringPolicies);

/* --- Households --------------------------------------------------------- */
router.get(
  '/',
  requirePermission(MODULES.HIB, 'view'),
  validate({ query: listHouseholdsQuery }),
  controller.listHouseholds,
);
router.post(
  '/',
  requirePermission(MODULES.HIB, 'create'),
  validate({ body: createHouseholdSchema }),
  audit({ action: 'create', resourceType: 'HibHousehold' }),
  controller.createHousehold,
);
router.get(
  '/:id',
  requirePermission(MODULES.HIB, 'view'),
  validate({ params: idParam }),
  controller.getHousehold,
);
router.patch(
  '/:id',
  requirePermission(MODULES.HIB, 'edit'),
  validate({ params: idParam, body: updateHouseholdSchema }),
  audit({ action: 'update', resourceType: 'HibHousehold' }),
  controller.updateHousehold,
);

/**
 * Linking a member number to a chart is audited because it decides whose
 * treatment draws on which family's ceiling — a mis-link silently spends one
 * household's cover on another household's care.
 */
router.post(
  '/:id/members/link',
  requirePermission(MODULES.HIB, 'verify'),
  validate({ params: idParam, body: linkMemberSchema }),
  audit({ action: 'update', resourceType: 'HibHousehold' }),
  controller.linkMember,
);

export default router;
