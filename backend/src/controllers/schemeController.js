import {
  Scheme,
  PatientEntitlement,
  SchemeClaim,
  Patient,
  Encounter,
  BillingLineItem,
} from '../models/index.js';
import { SCHEME_CLAIM_TRANSITIONS } from '../models/SchemeClaim.js';
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
} from '../utils/queryHelpers.js';
import {
  evaluateEligibility,
  apportion,
  remainingCeiling,
  periodKey,
} from '../services/schemeService.js';
import { roundPaisa, fiscalYearOf } from '../utils/nepal.js';

/* ==========================================================================
 * SCHEME DEFINITIONS
 * ======================================================================= */

export const listSchemes = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const now = new Date();
  const filter = andFilters(
    activeScope(query, req.user),
    query.claimRoute ? { claimRoute: query.claimRoute } : null,
    searchFilter(query.search, ['code', 'name', 'nameNe']),
    query.effectiveOnly
      ? {
          $and: [
            { $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: now } }] },
            { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }] },
          ],
        }
      : null,
  );

  const [rows, total] = await Promise.all([
    Scheme.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Scheme.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getScheme = asyncHandler(async (req, res) => {
  const scheme = await Scheme.findById(req.params.id);
  if (!scheme) throw ApiError.notFound('Scheme not found');
  return sendResponse(res, { data: scheme });
});

export const createScheme = asyncHandler(async (req, res) => {
  const existing = await Scheme.findOne({ code: req.body.code });
  if (existing) throw ApiError.conflict(`Scheme code "${req.body.code}" already exists`);

  const scheme = await Scheme.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Scheme ${scheme.code} created`, data: scheme });
});

export const updateScheme = asyncHandler(async (req, res) => {
  const scheme = await Scheme.findById(req.params.id);
  if (!scheme) throw ApiError.notFound('Scheme not found');

  Object.assign(scheme, req.body);
  scheme.updatedBy = req.user._id;
  await scheme.save();

  return sendResponse(res, { message: 'Scheme updated', data: scheme });
});

/* ==========================================================================
 * PATIENT ENTITLEMENTS
 * ======================================================================= */

export const listEntitlements = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.schemeCode ? { schemeCode: query.schemeCode } : null,
    query.status ? { status: query.status } : null,
    // The "free care applied without a sighted card" worklist — the finding
    // every scheme audit opens with.
    query.unverifiedOnly ? { verifiedAt: null, status: 'active' } : null,
  );

  const [rows, total] = await Promise.all([
    PatientEntitlement.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName firstNameNe lastNameNe' })
      .populate({ path: 'schemeId', select: 'code name nameNe ceilingAmount ceilingPeriod' })
      .populate({ path: 'verifiedBy', select: 'firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    PatientEntitlement.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createEntitlement = asyncHandler(async (req, res) => {
  const { patientId, schemeId } = req.body;

  const [patient, scheme] = await Promise.all([
    Patient.findById(patientId).lean(),
    Scheme.findById(schemeId).lean(),
  ]);
  if (!patient) throw ApiError.notFound('Patient not found');
  if (!scheme) throw ApiError.notFound('Scheme not found');

  const duplicate = await PatientEntitlement.findOne({
    patientId,
    schemeCode: scheme.code,
    status: 'active',
  });
  if (duplicate) {
    throw ApiError.conflict(
      `This patient already holds an active entitlement to ${scheme.name}.`,
      { code: 'DUPLICATE_ENTITLEMENT' },
    );
  }

  const entitlement = await PatientEntitlement.create({
    ...req.body,
    schemeCode: scheme.code,
    utilisationPeriod: periodKey(scheme),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: scheme.requiresDocument
      ? `Entitlement recorded. It cannot be used until the ${scheme.documentLabel || 'card'} is verified.`
      : 'Entitlement recorded',
    data: entitlement,
  });
});

/**
 * Confirm that the physical card was sighted.
 *
 * Separated from creation, and held under a narrower permission, because THIS
 * is the act that lets free care be applied. Recording that a card exists is
 * clerical; asserting that someone looked at it is the thing an auditor holds a
 * named person to.
 */
export const verifyEntitlement = asyncHandler(async (req, res) => {
  const entitlement = await PatientEntitlement.findById(req.params.id);
  if (!entitlement) throw ApiError.notFound('Entitlement not found');
  if (entitlement.status !== 'active') {
    throw ApiError.conflict(`Cannot verify a ${entitlement.status} entitlement`);
  }

  entitlement.verifiedBy = req.user._id;
  entitlement.verifiedAt = new Date();
  entitlement.verificationNote = req.body.verificationNote;
  entitlement.updatedBy = req.user._id;
  await entitlement.save();

  return sendResponse(res, { message: 'Entitlement verified', data: entitlement });
});

export const revokeEntitlement = asyncHandler(async (req, res) => {
  const entitlement = await PatientEntitlement.findById(req.params.id);
  if (!entitlement) throw ApiError.notFound('Entitlement not found');

  entitlement.status = 'revoked';
  entitlement.revokedAt = new Date();
  entitlement.revokedBy = req.user._id;
  entitlement.revokeReason = req.body.revokeReason;
  entitlement.updatedBy = req.user._id;
  await entitlement.save();

  return sendResponse(res, { message: 'Entitlement revoked', data: entitlement });
});

/* ==========================================================================
 * ELIGIBILITY AND APPORTIONMENT
 * ======================================================================= */

/** Normalise a query param that may arrive as a string or a repeated key. */
const asArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : String(value).split(',').map((v) => v.trim()).filter(Boolean);
};

/**
 * Which schemes this patient can draw on, and why.
 *
 * Ineligible schemes come back too, with their reasons. An empty list looks
 * like a broken system; "senior citizen — patient is 69, needs 70" is something
 * the counter can act on and explain.
 */
export const checkEligibility = asyncHandler(async (req, res) => {
  const query = getQuery(req);

  let diagnosisCodes = asArray(query.diagnosisCodes);
  let serviceCodes = asArray(query.serviceCodes);

  // Pull the codes off the encounter when one is named, so the counter does not
  // have to retype what the clinician already recorded.
  if (query.encounterId) {
    const encounter = await Encounter.findById(query.encounterId).lean();
    if (encounter && diagnosisCodes.length === 0) {
      diagnosisCodes = (encounter.diagnosis || []).map((d) => d.code).filter(Boolean);
    }
    if (encounter && serviceCodes.length === 0) {
      const lines = await BillingLineItem.find({ encounterId: query.encounterId })
        .select('serviceCode')
        .lean();
      serviceCodes = lines.map((l) => l.serviceCode).filter(Boolean);
    }
  }

  const results = await evaluateEligibility({
    patientId: query.patientId,
    diagnosisCodes,
    serviceCodes,
  });

  return sendResponse(res, {
    data: results,
    meta: {
      eligibleCount: results.filter((r) => r.eligible).length,
      evaluatedAgainst: { diagnosisCodes, serviceCodes },
    },
  });
});

/**
 * What each scheme would bear on this encounter's charges — a quotation.
 *
 * Writes nothing. This is what the counter shows a patient BEFORE treatment, so
 * the figure they are quoted is the figure that later appears on the bill.
 */
export const previewApportionment = asyncHandler(async (req, res) => {
  const { encounterId } = req.params;

  const encounter = await Encounter.findById(encounterId).lean();
  if (!encounter) throw ApiError.notFound('Encounter not found');

  const lines = await BillingLineItem.find({
    encounterId,
    isActive: true,
    status: { $ne: 'cancelled' },
  }).lean();

  if (lines.length === 0) {
    return sendResponse(res, {
      data: { grossTotal: 0, schemeCoveredAmount: 0, patientResponsibleAmount: 0, allocations: [] },
      message: 'No charges on this encounter yet.',
    });
  }

  const eligibilities = await evaluateEligibility({
    patientId: encounter.patientId,
    diagnosisCodes: (encounter.diagnosis || []).map((d) => d.code).filter(Boolean),
    serviceCodes: lines.map((l) => l.serviceCode).filter(Boolean),
  });

  const result = await apportion({ lines, eligibilities });

  return sendResponse(res, {
    data: result,
    meta: {
      ineligible: eligibilities
        .filter((e) => !e.eligible)
        .map((e) => ({ schemeName: e.schemeName, reasons: e.reasons })),
    },
  });
});

/* ==========================================================================
 * CLAIMS
 * ======================================================================= */

export const listClaims = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.schemeCode ? { schemeCode: query.schemeCode } : null,
    query.status ? { status: query.status } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.fiscalYear ? { fiscalYear: query.fiscalYear } : null,
    // Money about to be lost: past the filing deadline and still unfiled.
    query.lapsingOnly ? { status: 'draft', fileBy: { $lt: new Date() } } : null,
  );

  const [rows, total, outstanding] = await Promise.all([
    SchemeClaim.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'schemeId', select: 'code name nameNe' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    SchemeClaim.countDocuments(filter),
    SchemeClaim.aggregate([
      { $match: { status: { $in: ['submitted', 'under-review', 'approved', 'partially-approved'] } } },
      { $group: { _id: null, total: { $sum: '$claimedAmount' }, paid: { $sum: '$paidAmount' } } },
    ]),
  ]);

  return sendResponse(res, {
    data: rows,
    meta: {
      ...buildMeta({ page, limit, total }),
      // The number the accounts office actually wants: what government owes us.
      outstandingReceivable: roundPaisa(
        (outstanding[0]?.total || 0) - (outstanding[0]?.paid || 0),
      ),
    },
  });
});

export const getClaim = asyncHandler(async (req, res) => {
  const claim = await SchemeClaim.findById(req.params.id)
    .populate({ path: 'patientId', select: 'mrn firstName lastName firstNameNe lastNameNe' })
    .populate({ path: 'schemeId' })
    .populate({ path: 'invoiceId', select: 'invoiceNumber total status' });
  if (!claim) throw ApiError.notFound('Claim not found');
  return sendResponse(res, { data: claim });
});

function assertClaimTransition(from, to) {
  const allowed = SCHEME_CLAIM_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot move a claim from "${from}" to "${to}"`, {
      code: 'INVALID_STATUS_TRANSITION',
    });
  }
}

export const submitClaim = asyncHandler(async (req, res) => {
  const claim = await SchemeClaim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found');
  assertClaimTransition(claim.status, 'submitted');

  // Filing late is usually fatal to the claim. Warn rather than block — a late
  // claim is sometimes still accepted, and refusing to let the hospital try
  // guarantees the loss.
  const late = claim.fileBy && new Date(claim.fileBy) < new Date();

  claim.status = 'submitted';
  claim.submittedAt = new Date();
  claim.submittedBy = req.user._id;
  claim.externalReference = req.body.externalReference || '';
  claim.updatedBy = req.user._id;
  await claim.save();

  return sendResponse(res, {
    message: late
      ? `Claim ${claim.claimNumber} submitted — NOTE: it is past its filing deadline and may be refused.`
      : `Claim ${claim.claimNumber} submitted`,
    data: claim,
  });
});

export const recordDecision = asyncHandler(async (req, res) => {
  const claim = await SchemeClaim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found');

  const { status, approvedAmount, decisionNote, rejectionReason } = req.body;
  assertClaimTransition(claim.status, status);

  if (status !== 'rejected') {
    if (approvedAmount > claim.claimedAmount) {
      throw ApiError.badRequest(
        `The approved amount cannot exceed the claimed amount (${claim.claimedAmount}).`,
      );
    }
    claim.approvedAmount = roundPaisa(approvedAmount);
  } else {
    claim.approvedAmount = 0;
    claim.rejectionReason = rejectionReason;
  }

  claim.status = status;
  claim.decidedAt = new Date();
  claim.decisionNote = decisionNote || '';
  claim.updatedBy = req.user._id;
  await claim.save();

  return sendResponse(res, { message: `Claim ${claim.claimNumber} ${status}`, data: claim });
});

/**
 * The scheme receivables report.
 *
 * Answers the question no other screen does: how much has this hospital
 * delivered as free care that it has not yet been paid for, and how much of it
 * is about to become unclaimable.
 */
export const receivablesReport = asyncHandler(async (req, res) => {
  const fiscalYear = getQuery(req).fiscalYear || fiscalYearOf().code;

  const [byScheme, lapsing, unverified] = await Promise.all([
    SchemeClaim.aggregate([
      { $match: { fiscalYear, isActive: true } },
      {
        $group: {
          _id: '$schemeCode',
          claims: { $sum: 1 },
          claimed: { $sum: '$claimedAmount' },
          approved: { $sum: '$approvedAmount' },
          paid: { $sum: '$paidAmount' },
          unfiled: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        },
      },
      { $sort: { claimed: -1 } },
    ]),
    SchemeClaim.countDocuments({ status: 'draft', fileBy: { $lt: new Date() }, isActive: true }),
    PatientEntitlement.countDocuments({ status: 'active', verifiedAt: null, isActive: true }),
  ]);

  return sendResponse(res, {
    data: {
      fiscalYear,
      byScheme: byScheme.map((row) => ({
        schemeCode: row._id,
        claims: row.claims,
        claimedAmount: roundPaisa(row.claimed),
        approvedAmount: roundPaisa(row.approved),
        paidAmount: roundPaisa(row.paid),
        outstanding: roundPaisa((row.approved || row.claimed) - row.paid),
        unfiled: row.unfiled,
      })),
      exceptions: {
        /** Past the filing window and still unfiled — money already lost. */
        lapsedClaims: lapsing,
        /** Free care applied against a card nobody sighted. */
        unverifiedEntitlements: unverified,
      },
    },
  });
});

/** Remaining ceiling for one patient on one scheme — the counter's question. */
export const getRemainingCeiling = asyncHandler(async (req, res) => {
  const entitlement = await PatientEntitlement.findById(req.params.id).populate('schemeId');
  if (!entitlement) throw ApiError.notFound('Entitlement not found');

  const scheme = entitlement.schemeId;
  const remaining = remainingCeiling(scheme, entitlement);

  return sendResponse(res, {
    data: {
      schemeCode: scheme.code,
      ceilingAmount: scheme.ceilingAmount,
      ceilingPeriod: scheme.ceilingPeriod,
      utilisedAmount: entitlement.utilisedAmount,
      utilisationPeriod: entitlement.utilisationPeriod,
      remaining: Number.isFinite(remaining) ? remaining : null,
      unlimited: !Number.isFinite(remaining),
    },
  });
});
