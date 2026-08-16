import { HibHousehold, Encounter, Patient } from '../models/index.js';
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
  checkEligibility as evaluate,
  verifyReferralOnEncounter,
  apportionAgainstCeiling,
} from '../services/hibService.js';
import { roundPaisa } from '../utils/nepal.js';

export const listHouseholds = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  let expiring = null;
  if (query.expiringWithinDays !== undefined) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + query.expiringWithinDays);
    expiring = { policyTo: { $gte: new Date(), $lte: cutoff }, status: 'active' };
  }

  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.districtCode ? { districtCode: query.districtCode } : null,
    searchFilter(query.search, ['householdNumber', 'members.memberNumber', 'members.nameAsRegistered']),
    expiring,
  );

  const [rows, total] = await Promise.all([
    HibHousehold.find(filter).sort(sort).skip(skip).limit(limit),
    HibHousehold.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getHousehold = asyncHandler(async (req, res) => {
  const household = await HibHousehold.findById(req.params.id).populate({
    path: 'members.patientId',
    select: 'mrn firstName lastName firstNameNe lastNameNe phone',
  });
  if (!household) throw ApiError.notFound('Household not found');
  return sendResponse(res, { data: household });
});

export const createHousehold = asyncHandler(async (req, res) => {
  const existing = await HibHousehold.findOne({ householdNumber: req.body.householdNumber });
  if (existing) {
    throw ApiError.conflict(`Household ${req.body.householdNumber} is already registered`);
  }

  if (new Date(req.body.policyTo) <= new Date(req.body.policyFrom)) {
    throw ApiError.badRequest('The policy end date must fall after its start date.');
  }

  const household = await HibHousehold.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: `Household ${household.householdNumber} registered`,
    data: household,
  });
});

export const updateHousehold = asyncHandler(async (req, res) => {
  const household = await HibHousehold.findById(req.params.id);
  if (!household) throw ApiError.notFound('Household not found');

  // The ceiling is what everything else is measured against. Lowering it below
  // what the family has already drawn would make `remainingCeiling` negative
  // and silently change past apportionments' arithmetic.
  if (req.body.ceilingAmount !== undefined && req.body.ceilingAmount < household.utilisedAmount) {
    throw ApiError.conflict(
      `The ceiling cannot be set below what the household has already used (${household.utilisedAmount}).`,
      { code: 'CEILING_BELOW_UTILISATION' },
    );
  }

  Object.assign(household, req.body);
  household.updatedBy = req.user._id;
  await household.save();

  return sendResponse(res, { message: 'Household updated', data: household });
});

/**
 * Attach an HIB member number to a chart.
 *
 * HIB's member list and the hospital's patient index are populated separately,
 * so the link is made by a human matching a card to a chart. Until it exists,
 * eligibility cannot be checked for that patient at all.
 */
export const linkMember = asyncHandler(async (req, res) => {
  const { memberNumber, patientId } = req.body;

  const household = await HibHousehold.findById(req.params.id);
  if (!household) throw ApiError.notFound('Household not found');

  const member = household.members.find((m) => m.memberNumber === memberNumber);
  if (!member) throw ApiError.notFound(`No member ${memberNumber} on this household`);

  const patient = await Patient.findById(patientId).lean();
  if (!patient) throw ApiError.notFound('Patient not found');

  // One chart per member, and one member per chart — a patient linked to two
  // households would draw on two ceilings for the same treatment.
  const alreadyLinked = await HibHousehold.findOne({
    _id: { $ne: household._id },
    'members.patientId': patientId,
    'members.status': 'active',
  });
  if (alreadyLinked) {
    throw ApiError.conflict(
      `This patient is already linked to household ${alreadyLinked.householdNumber}.`,
      { code: 'PATIENT_ALREADY_LINKED' },
    );
  }

  member.patientId = patientId;
  household.updatedBy = req.user._id;
  await household.save();

  return sendResponse(res, {
    message: `${patient.firstName} ${patient.lastName} linked to member ${memberNumber}`,
    data: household,
  });
});

/**
 * The counter's question, answered before treatment rather than at billing.
 *
 * Returns a decision object even when cover fails — "not covered" is a normal
 * answer that the counter acts on, not an error. The patient is treated either
 * way; what changes is who pays.
 */
export const checkEligibility = asyncHandler(async (req, res) => {
  const { patientId, encounterId } = getQuery(req);

  let isEmergency = false;
  if (encounterId) {
    const encounter = await Encounter.findById(encounterId).lean();
    isEmergency = encounter?.type === 'emergency';
  }

  const decision = await evaluate({ patientId, isEmergency });

  // When cover is live and an encounter is named, confirm the referral against
  // what is actually recorded — a live policy is not the same as a claimable
  // one, and this is the last moment the paperwork can still be obtained.
  if (decision.covered && encounterId && decision.household) {
    decision.referral = await verifyReferralOnEncounter({
      encounterId,
      household: decision.household,
    });
  }

  return sendResponse(res, {
    data: {
      covered: decision.covered,
      reason: decision.reason ?? null,
      message: decision.message ?? null,
      remainingCeiling: decision.remainingCeiling ?? null,
      copayPercent: decision.copayPercent ?? 0,
      referral: decision.referral ?? null,
      household: decision.household
        ? {
            id: decision.household._id,
            householdNumber: decision.household.householdNumber,
            ceilingAmount: decision.household.ceilingAmount,
            utilisedAmount: decision.household.utilisedAmount,
            policyTo: decision.household.policyTo,
            firstContactPointName: decision.household.firstContactPointName,
          }
        : null,
      member: decision.member
        ? { memberNumber: decision.member.memberNumber, relationship: decision.member.relationship }
        : null,
    },
    /**
     * Surfaced separately because it is the thing the counter must say out loud:
     * cover can be live while this hospital still has no right to claim.
     */
    meta: {
      claimable: Boolean(decision.covered && (decision.referral?.satisfied ?? true)),
    },
  });
});

/**
 * What HIB would bear on a given amount — a quotation, writing nothing.
 *
 * Uses the same function the billing service uses at invoice time, so the
 * figure quoted to a patient before treatment is the figure that appears on
 * their bill afterwards.
 */
export const quote = asyncHandler(async (req, res) => {
  const { patientId, amount } = getQuery(req);

  const decision = await evaluate({ patientId });
  if (!decision.covered) {
    return sendResponse(res, {
      data: {
        covered: false,
        reason: decision.reason,
        message: decision.message,
        insuranceCoveredAmount: 0,
        patientResponsibleAmount: roundPaisa(Number(amount) || 0),
      },
    });
  }

  const split = apportionAgainstCeiling({
    billableAmount: Number(amount) || 0,
    remainingCeiling: decision.remainingCeiling,
    copayPercent: decision.copayPercent,
  });

  return sendResponse(res, { data: { covered: true, ...split } });
});

/** Policies about to lapse — the renewal worklist. */
export const expiringPolicies = asyncHandler(async (req, res) => {
  const days = Number(getQuery(req).days ?? 30);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const rows = await HibHousehold.find({
    status: 'active',
    isActive: true,
    policyTo: { $gte: new Date(), $lte: cutoff },
  })
    .sort({ policyTo: 1 })
    .limit(200)
    .lean();

  return sendResponse(res, {
    data: rows.map((h) => ({
      id: h._id,
      householdNumber: h.householdNumber,
      policyTo: h.policyTo,
      memberCount: (h.members || []).filter((m) => m.status === 'active').length,
      remainingCeiling: Math.max(0, (h.ceilingAmount || 0) - (h.utilisedAmount || 0)),
      subsidised: h.subsidised,
    })),
    meta: { withinDays: days, total: rows.length },
  });
});
