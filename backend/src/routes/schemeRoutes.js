import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  createSchemeSchema,
  updateSchemeSchema,
  listSchemesQuery,
  createEntitlementSchema,
  verifyEntitlementSchema,
  revokeEntitlementSchema,
  listEntitlementsQuery,
  eligibilityQuery,
  listSchemeClaimsQuery,
  submitClaimSchema,
  claimDecisionSchema,
} from '../validators/nepalValidator.js';
import * as controller from '../controllers/schemeController.js';

/**
 * Government free-care and subsidy schemes (A7).
 *
 * Note what is audited and what is not: reads are not, but every act that
 * changes who gets free care — creating an entitlement, verifying a card,
 * revoking it, deciding a claim — is. These are the rows a scheme auditor
 * asks for by name.
 */
const router = Router();
router.use(requireAuth);

/* --- Scheme definitions ------------------------------------------------- */
router.get(
  '/',
  requirePermission(MODULES.SCHEMES, 'view'),
  validate({ query: listSchemesQuery }),
  controller.listSchemes,
);
router.post(
  '/',
  requirePermission(MODULES.SCHEMES, 'create'),
  validate({ body: createSchemeSchema }),
  audit({ action: 'create', resourceType: 'Scheme' }),
  controller.createScheme,
);
router.get(
  '/:id',
  requirePermission(MODULES.SCHEMES, 'view'),
  validate({ params: idParam }),
  controller.getScheme,
);
router.patch(
  '/:id',
  requirePermission(MODULES.SCHEMES, 'edit'),
  validate({ params: idParam, body: updateSchemeSchema }),
  audit({ action: 'update', resourceType: 'Scheme' }),
  controller.updateScheme,
);

export default router;

/* ==========================================================================
 * Entitlements and claims mount on their own paths — they are separate
 * resources, not sub-resources of a scheme definition. A patient's entitlement
 * belongs to the patient at least as much as to the scheme.
 * ======================================================================= */

export const entitlementRouter = Router();
entitlementRouter.use(requireAuth);

/**
 * Eligibility first: literal paths must be declared before `/:id`, because
 * Express matches in order and a parameterised segment will otherwise swallow
 * them. These two are reads by design — asking whether a patient qualifies must
 * never change anything, so the counter can check as often as it likes.
 */
entitlementRouter.get(
  '/eligibility/check',
  requirePermission(MODULES.ENTITLEMENTS, 'view'),
  validate({ query: eligibilityQuery }),
  controller.checkEligibility,
);

/** What the schemes would bear on an encounter's charges. Writes nothing. */
entitlementRouter.get(
  '/eligibility/preview/:encounterId',
  requirePermission(MODULES.ENTITLEMENTS, 'view'),
  controller.previewApportionment,
);

entitlementRouter.get(
  '/',
  requirePermission(MODULES.ENTITLEMENTS, 'view'),
  validate({ query: listEntitlementsQuery }),
  controller.listEntitlements,
);
entitlementRouter.post(
  '/',
  requirePermission(MODULES.ENTITLEMENTS, 'create'),
  validate({ body: createEntitlementSchema }),
  audit({ action: 'create', resourceType: 'PatientEntitlement' }),
  controller.createEntitlement,
);
entitlementRouter.post(
  '/:id/verify',
  requirePermission(MODULES.ENTITLEMENTS, 'verify'),
  validate({ params: idParam, body: verifyEntitlementSchema }),
  audit({ action: 'verify', resourceType: 'PatientEntitlement' }),
  controller.verifyEntitlement,
);
entitlementRouter.post(
  '/:id/revoke',
  requirePermission(MODULES.ENTITLEMENTS, 'revoke'),
  validate({ params: idParam, body: revokeEntitlementSchema }),
  audit({ action: 'revoke', resourceType: 'PatientEntitlement' }),
  controller.revokeEntitlement,
);
entitlementRouter.get(
  '/:id/ceiling',
  requirePermission(MODULES.ENTITLEMENTS, 'view'),
  validate({ params: idParam }),
  controller.getRemainingCeiling,
);

export const schemeClaimRouter = Router();
schemeClaimRouter.use(requireAuth);

schemeClaimRouter.get(
  '/',
  requirePermission(MODULES.SCHEME_CLAIMS, 'view'),
  validate({ query: listSchemeClaimsQuery }),
  controller.listClaims,
);
schemeClaimRouter.get(
  '/receivables',
  requirePermission(MODULES.SCHEME_CLAIMS, 'view'),
  controller.receivablesReport,
);
schemeClaimRouter.get(
  '/:id',
  requirePermission(MODULES.SCHEME_CLAIMS, 'view'),
  validate({ params: idParam }),
  controller.getClaim,
);
schemeClaimRouter.post(
  '/:id/submit',
  requirePermission(MODULES.SCHEME_CLAIMS, 'submit'),
  validate({ params: idParam, body: submitClaimSchema }),
  audit({ action: 'submit', resourceType: 'SchemeClaim' }),
  controller.submitClaim,
);
schemeClaimRouter.post(
  '/:id/decision',
  requirePermission(MODULES.SCHEME_CLAIMS, 'recordDecision'),
  validate({ params: idParam, body: claimDecisionSchema }),
  audit({ action: 'update', resourceType: 'SchemeClaim' }),
  controller.recordDecision,
);
