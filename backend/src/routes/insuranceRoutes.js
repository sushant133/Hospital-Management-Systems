import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listProvidersQuery,
  createProviderSchema,
  updateProviderSchema,
  listPoliciesQuery,
  createPolicySchema,
  updatePolicySchema,
  verifyPolicySchema,
  listPreAuthsQuery,
  createPreAuthSchema,
  preAuthDecisionSchema,
  claimPreviewQuery,
  listClaimsQuery,
  createClaimSchema,
  submitClaimSchema,
  claimDecisionSchema,
  settleClaimSchema,
  agingQuery,
  settlementQuery,
} from '../validators/insuranceValidator.js';
import * as controller from '../controllers/insuranceController.js';

const router = Router();

router.use(requireAuth);

const PROVIDERS = MODULES.INSURANCE_PROVIDERS;
const POLICIES = MODULES.PATIENT_POLICIES;
const PREAUTH = MODULES.PRE_AUTHORIZATIONS;
const CLAIMS = MODULES.CLAIMS;

/** Literal paths first, so '/claims/preview' is not read as a claim id. */

// --- Reports ---
router.get(
  '/reports/aging',
  requirePermission(CLAIMS, 'view'),
  validate({ query: agingQuery }),
  controller.getAging,
);

router.get(
  '/reports/settlement',
  requirePermission(CLAIMS, 'view'),
  validate({ query: settlementQuery }),
  controller.getSettlement,
);

// --- Insurers ---
router.get(
  '/providers',
  requirePermission(PROVIDERS, 'view'),
  validate({ query: listProvidersQuery }),
  controller.listProviders,
);

router.post(
  '/providers',
  requirePermission(PROVIDERS, 'create'),
  validate({ body: createProviderSchema }),
  audit({ action: 'create', resourceType: 'InsuranceProvider' }),
  controller.createProvider,
);

router.patch(
  '/providers/:id',
  requirePermission(PROVIDERS, 'edit'),
  validate({ params: idParam, body: updateProviderSchema }),
  audit({ action: 'update', resourceType: 'InsuranceProvider' }),
  controller.updateProvider,
);

// --- Policies ---
router.get(
  '/policies',
  requirePermission(POLICIES, 'view'),
  validate({ query: listPoliciesQuery }),
  controller.listPolicies,
);

router.post(
  '/policies',
  requirePermission(POLICIES, 'create'),
  validate({ body: createPolicySchema }),
  audit({ action: 'create', resourceType: 'PatientPolicy' }),
  controller.createPolicy,
);

/** A read-only check — records nothing, so it needs no audit entry. */
router.get(
  '/policies/:id/eligibility',
  requirePermission(POLICIES, 'view'),
  validate({ params: idParam }),
  controller.getEligibility,
);

/** Recording that someone confirmed the cover, and when. */
router.post(
  '/policies/:id/verify',
  requirePermission(POLICIES, 'verifyEligibility'),
  validate({ params: idParam, body: verifyPolicySchema }),
  audit({ action: 'update', resourceType: 'PatientPolicy' }),
  controller.verifyEligibility,
);

router.patch(
  '/policies/:id',
  requirePermission(POLICIES, 'edit'),
  validate({ params: idParam, body: updatePolicySchema }),
  audit({ action: 'update', resourceType: 'PatientPolicy' }),
  controller.updatePolicy,
);

router.delete(
  '/policies/:id',
  requirePermission(POLICIES, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'PatientPolicy' }),
  controller.deletePolicy,
);

// --- Pre-authorisations ---
router.get(
  '/pre-authorizations',
  requirePermission(PREAUTH, 'view'),
  validate({ query: listPreAuthsQuery }),
  controller.listPreAuths,
);

router.post(
  '/pre-authorizations',
  requirePermission(PREAUTH, 'create'),
  validate({ body: createPreAuthSchema }),
  audit({ action: 'create', resourceType: 'PreAuthorization' }),
  controller.createPreAuth,
);

router.post(
  '/pre-authorizations/:id/submit',
  requirePermission(PREAUTH, 'submit'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'PreAuthorization' }),
  controller.submitPreAuth,
);

router.post(
  '/pre-authorizations/:id/decision',
  requirePermission(PREAUTH, 'recordDecision'),
  validate({ params: idParam, body: preAuthDecisionSchema }),
  audit({ action: 'approve', resourceType: 'PreAuthorization' }),
  controller.recordPreAuthDecision,
);

// --- Claims ---
/** What a claim would look like — the co-pay split before anything is written. */
router.get(
  '/claims/preview',
  requirePermission(CLAIMS, 'view'),
  validate({ query: claimPreviewQuery }),
  controller.previewClaim,
);

router.get(
  '/claims',
  requirePermission(CLAIMS, 'view'),
  validate({ query: listClaimsQuery }),
  controller.listClaims,
);

router.post(
  '/claims',
  requirePermission(CLAIMS, 'create'),
  validate({ body: createClaimSchema }),
  audit({ action: 'create', resourceType: 'Claim' }),
  controller.createClaim,
);

router.get(
  '/claims/:id',
  requirePermission(CLAIMS, 'view'),
  validate({ params: idParam }),
  controller.getClaim,
);

router.post(
  '/claims/:id/submit',
  requirePermission(CLAIMS, 'submit'),
  validate({ params: idParam, body: submitClaimSchema }),
  audit({ action: 'update', resourceType: 'Claim' }),
  controller.submitClaim,
);

router.post(
  '/claims/:id/decision',
  requirePermission(CLAIMS, 'recordDecision'),
  validate({ params: idParam, body: claimDecisionSchema }),
  audit({ action: 'approve', resourceType: 'Claim' }),
  controller.recordClaimDecision,
);

router.post(
  '/claims/:id/settle',
  requirePermission(CLAIMS, 'recordDecision'),
  validate({ params: idParam, body: settleClaimSchema }),
  audit({ action: 'update', resourceType: 'Claim' }),
  controller.settleClaim,
);

export default router;
