import {
  InsuranceProvider,
  PatientPolicy,
  PreAuthorization,
  Claim,
  Invoice,
  BillingLineItem,
  Patient,
  Encounter,
  PREAUTH_TRANSITIONS,
  CLAIM_TRANSITIONS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
  searchFilter,
  softDeletePatch,
} from '../utils/queryHelpers.js';
import {
  checkEligibility,
  splitCoPay,
  claimableCharges,
  applyExclusions,
  adjustCoverageUsed,
  agingReport,
  settlementReport,
} from '../services/insuranceService.js';

const POLICY_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth' },
  { path: 'providerId', select: 'code name kind defaultCoPayPercent settlementDays' },
  { path: 'verifiedBy', select: 'firstName lastName' },
];

const CLAIM_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName' },
  { path: 'encounterId', select: 'encounterNumber type startedAt' },
  { path: 'providerId', select: 'code name kind settlementDays' },
  { path: 'policyId', select: 'policyNumber planName coPayPercent' },
  { path: 'preAuthId', select: 'preAuthNumber authorizationCode approvedAmount status' },
];

const PREAUTH_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName' },
  { path: 'encounterId', select: 'encounterNumber type' },
  { path: 'providerId', select: 'code name' },
  { path: 'policyId', select: 'policyNumber planName' },
];

function assertTransition(map, from, to, subject) {
  const allowed = map[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `Cannot move a ${subject} from "${from}" to "${to}".` +
        (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This is final.'),
      { code: 'INVALID_STATUS_TRANSITION' },
    );
  }
}

// ------------------------------------------------------------- providers ----

/** GET /insurance/providers */
export const listProviders = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    searchFilter(query.search, ['name', 'code']),
    query.kind ? { kind: query.kind } : null,
  );

  const [providers, total] = await Promise.all([
    InsuranceProvider.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    InsuranceProvider.countDocuments(filter),
  ]);

  return sendResponse(res, { data: providers, meta: buildMeta({ page, limit, total }) });
});

/** POST /insurance/providers */
export const createProvider = asyncHandler(async (req, res) => {
  const existing = await InsuranceProvider.findOne({ code: req.body.code.toUpperCase() });
  if (existing) {
    throw ApiError.conflict(`A provider with code ${req.body.code} already exists`, {
      code: 'PROVIDER_CODE_TAKEN',
    });
  }

  const provider = await InsuranceProvider.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, { message: 'Insurer added', data: provider });
});

/** PATCH /insurance/providers/:id */
export const updateProvider = asyncHandler(async (req, res) => {
  const provider = await InsuranceProvider.findById(req.params.id);
  if (!provider) throw ApiError.notFound('Insurer not found');

  Object.assign(provider, req.body);
  provider.updatedBy = req.user._id;
  await provider.save();

  return sendResponse(res, { message: 'Insurer updated', data: provider });
});

// -------------------------------------------------------------- policies ----

/** GET /insurance/policies */
export const listPolicies = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.providerId ? { providerId: query.providerId } : null,
    query.status ? { status: query.status } : null,
  );

  const [policies, total] = await Promise.all([
    PatientPolicy.find(filter).populate(POLICY_POPULATE).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    PatientPolicy.countDocuments(filter),
  ]);

  return sendResponse(res, { data: policies, meta: buildMeta({ page, limit, total }) });
});

/** POST /insurance/policies — link a patient to cover. */
export const createPolicy = asyncHandler(async (req, res) => {
  const patient = await Patient.exists({ _id: req.body.patientId, isActive: true });
  if (!patient) {
    throw ApiError.badRequest('That patient does not exist or is inactive', {
      details: [{ field: 'patientId', message: 'Invalid patient' }],
    });
  }

  const provider = await InsuranceProvider.findOne({ _id: req.body.providerId, isActive: true }).lean();
  if (!provider) {
    throw ApiError.badRequest('That insurer does not exist or is inactive', {
      details: [{ field: 'providerId', message: 'Invalid insurer' }],
    });
  }

  const duplicate = await PatientPolicy.findOne({
    providerId: req.body.providerId,
    policyNumber: req.body.policyNumber,
  });
  if (duplicate) {
    throw ApiError.conflict('That policy number is already recorded for this insurer', {
      code: 'POLICY_NUMBER_TAKEN',
    });
  }

  const policy = await PatientPolicy.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await policy.populate(POLICY_POPULATE);
  return sendCreated(res, { message: 'Policy linked to the patient', data: policy });
});

/** PATCH /insurance/policies/:id */
export const updatePolicy = asyncHandler(async (req, res) => {
  const policy = await PatientPolicy.findById(req.params.id);
  if (!policy) throw ApiError.notFound('Policy not found');

  // Coverage used is moved by claim decisions, not typed in.
  const { coverageUsed, ...rest } = req.body;

  Object.assign(policy, rest);
  policy.updatedBy = req.user._id;
  await policy.save();

  await policy.populate(POLICY_POPULATE);
  return sendResponse(res, { message: 'Policy updated', data: policy });
});

/** DELETE /insurance/policies/:id */
export const deletePolicy = asyncHandler(async (req, res) => {
  const policy = await PatientPolicy.findById(req.params.id);
  if (!policy) throw ApiError.notFound('Policy not found');

  const openClaims = await Claim.countDocuments({
    policyId: policy._id,
    isActive: true,
    status: { $nin: ['settled', 'rejected'] },
  });
  if (openClaims > 0) {
    throw ApiError.conflict(
      `Cannot remove this policy while ${openClaims} claim(s) against it are still open.`,
      { code: 'POLICY_HAS_OPEN_CLAIMS' },
    );
  }

  Object.assign(policy, softDeletePatch(req.user));
  await policy.save();

  return sendResponse(res, { message: 'Policy removed', data: { _id: policy._id } });
});

/**
 * POST /insurance/policies/:id/verify — confirm the cover is live.
 *
 * Recording *who* checked and *when* matters: a policy nobody has verified is
 * still usable, but the desk can see that nobody has confirmed it.
 */
export const verifyEligibility = asyncHandler(async (req, res) => {
  const policy = await PatientPolicy.findById(req.params.id);
  if (!policy) throw ApiError.notFound('Policy not found');

  const provider = await InsuranceProvider.findById(policy.providerId).lean();
  const eligibility = checkEligibility(policy, provider);

  if (req.body.status) policy.status = req.body.status;
  policy.verifiedAt = new Date();
  policy.verifiedBy = req.user._id;
  policy.verificationNotes = req.body.notes ?? '';
  policy.updatedBy = req.user._id;
  await policy.save();

  await policy.populate(POLICY_POPULATE);
  return sendResponse(res, {
    message: eligibility.eligible
      ? 'Eligibility confirmed'
      : `Checked — not currently eligible: ${eligibility.reasons.join('; ')}`,
    data: policy,
    meta: { eligibility: checkEligibility(policy, provider) },
  });
});

/** GET /insurance/policies/:id/eligibility — check without recording anything. */
export const getEligibility = asyncHandler(async (req, res) => {
  const policy = await PatientPolicy.findById(req.params.id).lean();
  if (!policy) throw ApiError.notFound('Policy not found');

  const provider = await InsuranceProvider.findById(policy.providerId).lean();

  return sendResponse(res, {
    data: checkEligibility(policy, provider),
    meta: { policyNumber: policy.policyNumber, provider: provider?.name },
  });
});

// ------------------------------------------------------ pre-authorisation ----

/** GET /insurance/pre-authorizations */
export const listPreAuths = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.policyId ? { policyId: query.policyId } : null,
    query.status ? { status: query.status } : null,
  );

  const [preAuths, total] = await Promise.all([
    PreAuthorization.find(filter).populate(PREAUTH_POPULATE).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    PreAuthorization.countDocuments(filter),
  ]);

  return sendResponse(res, { data: preAuths, meta: buildMeta({ page, limit, total }) });
});

/** POST /insurance/pre-authorizations */
export const createPreAuth = asyncHandler(async (req, res) => {
  const policy = await PatientPolicy.findOne({ _id: req.body.policyId, isActive: true }).lean();
  if (!policy) {
    throw ApiError.badRequest('That policy does not exist', {
      details: [{ field: 'policyId', message: 'Invalid policy' }],
    });
  }

  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('That visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }
  if (String(encounter.patientId) !== String(policy.patientId)) {
    throw ApiError.badRequest('The visit and the policy belong to different patients', {
      details: [{ field: 'encounterId', message: 'Patient mismatch' }],
    });
  }

  const provider = await InsuranceProvider.findById(policy.providerId).lean();
  const eligibility = checkEligibility(policy, provider);

  const preAuth = await PreAuthorization.create({
    ...req.body,
    patientId: policy.patientId,
    providerId: policy.providerId,
    status: 'draft',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await preAuth.populate(PREAUTH_POPULATE);
  return sendCreated(res, {
    message: eligibility.eligible
      ? 'Pre-authorisation drafted'
      : `Drafted, but the policy is not currently eligible: ${eligibility.reasons.join('; ')}`,
    data: preAuth,
    meta: { eligibility },
  });
});

/** POST /insurance/pre-authorizations/:id/submit */
export const submitPreAuth = asyncHandler(async (req, res) => {
  const preAuth = await PreAuthorization.findById(req.params.id);
  if (!preAuth) throw ApiError.notFound('Pre-authorisation not found');

  assertTransition(PREAUTH_TRANSITIONS, preAuth.status, 'submitted', 'pre-authorisation');

  preAuth.status = 'submitted';
  preAuth.submittedAt = new Date();
  preAuth.submittedBy = req.user._id;
  preAuth.updatedBy = req.user._id;
  await preAuth.save();

  await preAuth.populate(PREAUTH_POPULATE);
  return sendResponse(res, { message: 'Sent to the insurer', data: preAuth });
});

/** POST /insurance/pre-authorizations/:id/decision — record the insurer's answer. */
export const recordPreAuthDecision = asyncHandler(async (req, res) => {
  const preAuth = await PreAuthorization.findById(req.params.id);
  if (!preAuth) throw ApiError.notFound('Pre-authorisation not found');

  const { status, approvedAmount, authorizationCode, validUntil, notes } = req.body;

  assertTransition(PREAUTH_TRANSITIONS, preAuth.status, status, 'pre-authorisation');

  if (['approved', 'partially-approved'].includes(status)) {
    if (!authorizationCode) {
      throw ApiError.validation('An approval needs an authorisation code', [
        { field: 'authorizationCode', message: 'Required for an approval' },
      ]);
    }
    if (approvedAmount > preAuth.estimatedTotal) {
      throw ApiError.badRequest(
        `The insurer cannot approve more (${approvedAmount}) than was requested (${preAuth.estimatedTotal}).`,
        { code: 'APPROVED_EXCEEDS_REQUEST' },
      );
    }
  }

  preAuth.status = status;
  preAuth.approvedAmount = ['approved', 'partially-approved'].includes(status) ? approvedAmount : 0;
  preAuth.authorizationCode = authorizationCode ?? '';
  preAuth.validUntil = validUntil ?? null;
  preAuth.decisionAt = new Date();
  preAuth.decisionBy = req.user._id;
  preAuth.decisionNotes = notes ?? '';
  preAuth.updatedBy = req.user._id;
  await preAuth.save();

  await preAuth.populate(PREAUTH_POPULATE);
  return sendResponse(res, { message: `Decision recorded: ${status}`, data: preAuth });
});

// ---------------------------------------------------------------- claims ----

/**
 * GET /insurance/claims/preview — what a claim would look like.
 *
 * Shows the claimable charges, what the insurer excludes, and the co-pay split,
 * before anything is written. The desk needs the patient's share before the
 * patient leaves.
 */
export const previewClaim = asyncHandler(async (req, res) => {
  const { encounterId, policyId } = getQuery(req);

  const policy = await PatientPolicy.findById(policyId).lean();
  if (!policy) throw ApiError.notFound('Policy not found');

  const provider = await InsuranceProvider.findById(policy.providerId).lean();
  const eligibility = checkEligibility(policy, provider);

  const charges = await claimableCharges({ encounterId });
  const { covered, excluded } = applyExclusions(charges, provider);

  const gross = covered.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const split = splitCoPay({ grossAmount: gross, policy, provider });

  return sendResponse(res, {
    data: {
      lines: covered,
      excluded,
      split,
    },
    meta: {
      eligibility,
      excludedTotal:
        Math.round(excluded.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0) * 100) / 100,
      claimableCount: covered.length,
    },
  });
});

/** GET /insurance/claims */
export const listClaims = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.providerId ? { providerId: query.providerId } : null,
    query.policyId ? { policyId: query.policyId } : null,
    query.status ? { status: query.status } : null,
    query.openOnly
      ? { status: { $in: ['draft', 'submitted', 'under-review', 'resubmitted', 'partially-approved'] } }
      : null,
  );

  const [claims, total] = await Promise.all([
    Claim.find(filter).populate(CLAIM_POPULATE).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Claim.countDocuments(filter),
  ]);

  return sendResponse(res, { data: claims, meta: buildMeta({ page, limit, total }) });
});

/** GET /insurance/claims/:id */
export const getClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate(CLAIM_POPULATE).lean({ virtuals: true });
  if (!claim) throw ApiError.notFound('Claim not found');
  return sendResponse(res, { data: claim });
});

/**
 * POST /insurance/claims — build a claim from an encounter's charges.
 *
 * **Phase 10 has not issued invoices yet**, so the claim is raised against the
 * encounter's charge ledger; `invoiceId` is left for when invoicing lands.
 */
export const createClaim = asyncHandler(async (req, res) => {
  const policy = await PatientPolicy.findOne({ _id: req.body.policyId, isActive: true }).lean();
  if (!policy) {
    throw ApiError.badRequest('That policy does not exist', {
      details: [{ field: 'policyId', message: 'Invalid policy' }],
    });
  }

  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('That visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }
  if (String(encounter.patientId) !== String(policy.patientId)) {
    throw ApiError.badRequest('The visit and the policy belong to different patients', {
      details: [{ field: 'encounterId', message: 'Patient mismatch' }],
    });
  }

  const provider = await InsuranceProvider.findById(policy.providerId).lean();
  const eligibility = checkEligibility(policy, provider);
  if (!eligibility.eligible) {
    throw ApiError.conflict(
      `This policy is not currently eligible: ${eligibility.reasons.join('; ')}`,
      { code: 'POLICY_NOT_ELIGIBLE', details: { reasons: eligibility.reasons } },
    );
  }

  if (req.body.preAuthId) {
    const preAuth = await PreAuthorization.findById(req.body.preAuthId);
    if (!preAuth) {
      throw ApiError.badRequest('That pre-authorisation does not exist', {
        details: [{ field: 'preAuthId', message: 'Invalid pre-authorisation' }],
      });
    }
    if (!preAuth.isUsable) {
      throw ApiError.conflict(
        preAuth.isExpired
          ? 'That pre-authorisation has expired and cannot support a claim.'
          : `A ${preAuth.status} pre-authorisation cannot support a claim.`,
        { code: 'PREAUTH_NOT_USABLE', details: { status: preAuth.status } },
      );
    }
  }

  let invoice = null;
  if (req.body.invoiceId) {
    invoice = await Invoice.findOne({
      _id: req.body.invoiceId,
      encounterId: req.body.encounterId,
      isActive: true,
      status: { $ne: 'void' },
    });
    if (!invoice) {
      throw ApiError.badRequest('That invoice does not belong to this visit', {
        details: [{ field: 'invoiceId', message: 'Invalid invoice' }],
      });
    }
  }

  const charges = invoice
    ? await BillingLineItem.find({
        invoiceId: invoice._id,
        isActive: true,
        status: { $ne: 'cancelled' },
      }).lean()
    : await claimableCharges({ encounterId: req.body.encounterId });
  if (charges.length === 0) {
    throw ApiError.conflict('There are no unclaimed charges on this visit', {
      code: 'NOTHING_TO_CLAIM',
    });
  }

  const { covered } = applyExclusions(charges, provider);
  if (covered.length === 0) {
    throw ApiError.conflict('Every charge on this visit is excluded by the insurer', {
      code: 'ALL_CHARGES_EXCLUDED',
    });
  }

  const gross = covered.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const split = splitCoPay({ grossAmount: gross, policy, provider });

  if (!invoice) {
    invoice = await Invoice.findOne({
      encounterId: req.body.encounterId,
      isActive: true,
      status: { $ne: 'void' },
    })
      .select('_id')
      .lean();
  }

  const claim = await Claim.create({
    patientId: policy.patientId,
    encounterId: req.body.encounterId,
    invoiceId: invoice?._id ?? null,
    policyId: policy._id,
    providerId: policy.providerId,
    preAuthId: req.body.preAuthId ?? null,
    lines: covered.map((line) => ({
      billingLineItemId: line._id,
      description: line.description,
      itemCode: line.itemCode,
      sourceType: line.sourceType,
      quantity: line.quantity,
      amount: line.lineTotal,
    })),
    grossAmount: split.grossAmount,
    patientResponsible: split.patientResponsible,
    claimedAmount: split.insurerShare,
    status: 'draft',
    notes: req.body.notes ?? '',
    history: [{ status: 'draft', at: new Date(), by: req.user._id, amount: split.insurerShare }],
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await claim.populate(CLAIM_POPULATE);
  return sendCreated(res, {
    message: `Claim drafted — ${split.insurerShare} from the insurer, ${split.patientResponsible} from the patient`,
    data: claim,
    meta: { split },
  });
});

/** POST /insurance/claims/:id/submit */
export const submitClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found');

  const target = claim.status === 'rejected' || claim.status === 'partially-approved'
    ? 'resubmitted'
    : 'submitted';

  assertTransition(CLAIM_TRANSITIONS, claim.status, target, 'claim');

  claim.status = target;
  claim.submittedAt = claim.submittedAt ?? new Date();
  claim.submittedBy = req.user._id;
  claim.insurerReference = req.body.insurerReference ?? claim.insurerReference;
  claim.history.push({
    status: target,
    at: new Date(),
    by: req.user._id,
    amount: claim.claimedAmount,
    notes: req.body.notes ?? '',
  });
  claim.updatedBy = req.user._id;
  await claim.save();

  await claim.populate(CLAIM_POPULATE);
  return sendResponse(res, {
    message: target === 'resubmitted' ? 'Resubmitted to the insurer' : 'Submitted to the insurer',
    data: claim,
  });
});

/**
 * POST /insurance/claims/:id/decision — record the insurer's answer.
 *
 * An approval consumes the policy's annual limit, so the remaining cover stays
 * honest for the next claim.
 */
export const recordClaimDecision = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found');

  const { status, approvedAmount = 0, rejectedAmount = 0, rejectionReason, notes, insurerReference } = req.body;

  assertTransition(CLAIM_TRANSITIONS, claim.status, status, 'claim');

  if (['approved', 'partially-approved'].includes(status)) {
    if (approvedAmount > claim.claimedAmount) {
      throw ApiError.badRequest(
        `The insurer cannot approve more (${approvedAmount}) than was claimed (${claim.claimedAmount}).`,
        { code: 'APPROVED_EXCEEDS_CLAIM' },
      );
    }
    if (status === 'partially-approved' && approvedAmount >= claim.claimedAmount) {
      throw ApiError.badRequest(
        'A partial approval must be for less than the claimed amount — record it as approved instead.',
        { code: 'NOT_A_PARTIAL_APPROVAL' },
      );
    }
  }

  if (status === 'rejected' && !rejectionReason) {
    throw ApiError.validation('A rejection needs a reason', [
      { field: 'rejectionReason', message: 'Required when rejecting a claim' },
    ]);
  }

  // Move the policy's used cover by the change in what the insurer has agreed.
  const previouslyApproved = claim.approvedAmount ?? 0;
  const nowApproved = ['approved', 'partially-approved'].includes(status) ? approvedAmount : 0;
  const delta = nowApproved - previouslyApproved;

  claim.status = status;
  claim.approvedAmount = nowApproved;
  /**
   * The insurer's own disallowed figure is used when they state one; otherwise
   * it is the remainder of what was claimed. They do not always agree — an
   * insurer may hold part of a claim over rather than reject it outright.
   */
  claim.rejectedAmount =
    status === 'rejected'
      ? claim.claimedAmount
      : rejectedAmount > 0
        ? rejectedAmount
        : Math.max(0, Math.round((claim.claimedAmount - nowApproved) * 100) / 100);
  claim.rejectionReason = rejectionReason ?? '';
  claim.decisionAt = new Date();
  claim.insurerReference = insurerReference ?? claim.insurerReference;
  claim.history.push({
    status,
    at: new Date(),
    by: req.user._id,
    amount: nowApproved,
    notes: notes ?? rejectionReason ?? '',
  });
  claim.updatedBy = req.user._id;
  await claim.save();

  if (delta !== 0) {
    await adjustCoverageUsed({ policyId: claim.policyId, delta, user: req.user });
  }

  await claim.populate(CLAIM_POPULATE);
  return sendResponse(res, { message: `Decision recorded: ${status}`, data: claim });
});

/** POST /insurance/claims/:id/settle — the money arrived. */
export const settleClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found');

  assertTransition(CLAIM_TRANSITIONS, claim.status, 'settled', 'claim');

  const { settledAmount } = req.body;

  if (settledAmount > claim.approvedAmount) {
    throw ApiError.badRequest(
      `Cannot settle more (${settledAmount}) than was approved (${claim.approvedAmount}).`,
      { code: 'SETTLED_EXCEEDS_APPROVED' },
    );
  }

  claim.status = 'settled';
  claim.settledAmount = settledAmount;
  claim.settledAt = new Date();
  claim.insurerReference = req.body.insurerReference ?? claim.insurerReference;
  claim.history.push({
    status: 'settled',
    at: new Date(),
    by: req.user._id,
    amount: settledAmount,
    notes: req.body.notes ?? '',
  });
  claim.updatedBy = req.user._id;
  await claim.save();

  const shortfall = Math.round((claim.approvedAmount - settledAmount) * 100) / 100;

  await claim.populate(CLAIM_POPULATE);
  return sendResponse(res, {
    message: shortfall > 0
      ? `Settled ${settledAmount} — ${shortfall} short of the approved amount`
      : `Settled in full: ${settledAmount}`,
    data: claim,
    meta: { shortfall },
  });
});

// ------------------------------------------------------------- reporting ----

/** GET /insurance/reports/aging — outstanding receivables by age and insurer. */
export const getAging = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const report = await agingReport({ providerId: query.providerId ?? null });

  return sendResponse(res, {
    data: report.claims,
    meta: {
      buckets: report.buckets,
      byProvider: report.byProvider,
      totals: report.totals,
    },
  });
});

/** GET /insurance/reports/settlement — what was claimed against what was paid. */
export const getSettlement = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const report = await settlementReport({
    from: query.from,
    to: query.to,
    providerId: query.providerId ?? null,
  });

  return sendResponse(res, { data: report.providers, meta: report.totals });
});
