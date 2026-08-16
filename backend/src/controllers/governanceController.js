import {
  Problem,
  CarePlan,
  DeviceDay,
  HaiCase,
  IsolationOrder,
  AntibioticApproval,
  IncidentReport,

  Complaint,
  Referral,
  Drug,
} from '../models/index.js';
import { REFERRAL_TRANSITIONS } from '../models/Referral.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter } from '../utils/queryHelpers.js';

/* ==========================================================================
 * B8 — PROBLEM LIST AND CARE PLANS
 * ======================================================================= */

export const listProblems = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: query.sort || '-recordedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.status ? { status: query.status } : { status: { $ne: 'entered-in-error' } },
    query.chronicOnly ? { isChronic: true } : null,
  );

  const [rows, total] = await Promise.all([
    // Priority problems first: this list opens at the top of every encounter,
    // and what matters must be visible without scrolling.
    Problem.find(filter)
      .populate({ path: 'recordedBy resolvedBy', select: 'firstName lastName' })
      .sort({ isPriority: -1, status: 1, recordedAt: -1 })
      .skip(skip).limit(limit).lean(),
    Problem.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createProblem = asyncHandler(async (req, res) => {
  const problem = await Problem.create({
    ...req.body,
    recordedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Problem added to the list', data: problem });
});

export const updateProblem = asyncHandler(async (req, res) => {
  const problem = await Problem.findById(req.params.id);
  if (!problem) throw ApiError.notFound('Problem not found');
  Object.assign(problem, req.body);
  problem.updatedBy = req.user._id;
  await problem.save();
  return sendResponse(res, { message: 'Problem updated', data: problem });
});

/** Resolved is not deleted — the entry stays with its dates. */
export const resolveProblem = asyncHandler(async (req, res) => {
  const problem = await Problem.findById(req.params.id);
  if (!problem) throw ApiError.notFound('Problem not found');

  problem.status = 'resolved';
  problem.resolvedDate = req.body.resolvedDate;
  problem.resolutionNote = req.body.resolutionNote || '';
  problem.resolvedBy = req.user._id;
  problem.updatedBy = req.user._id;
  await problem.save();

  return sendResponse(res, { message: 'Problem resolved', data: problem });
});

export const listCarePlans = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.status ? { status: query.status } : null,
  );

  const [rows, total] = await Promise.all([
    CarePlan.find(filter).populate({ path: 'problemIds', select: 'display status' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    CarePlan.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createCarePlan = asyncHandler(async (req, res) => {
  const plan = await CarePlan.create({
    ...req.body,
    createdByRole: req.user.role,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Care plan created', data: plan });
});

export const reviewCarePlan = asyncHandler(async (req, res) => {
  const plan = await CarePlan.findById(req.params.id);
  if (!plan) throw ApiError.notFound('Care plan not found');

  Object.assign(plan, req.body);
  plan.lastReviewedAt = new Date();
  plan.lastReviewedBy = req.user._id;
  plan.updatedBy = req.user._id;
  await plan.save();

  return sendResponse(res, { message: 'Care plan reviewed', data: plan });
});

/* ==========================================================================
 * B9 — INFECTION CONTROL AND STEWARDSHIP
 * ======================================================================= */

export const insertDevice = asyncHandler(async (req, res) => {
  const device = await DeviceDay.create({
    ...req.body,
    insertedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Device insertion recorded', data: device });
});

export const removeDevice = asyncHandler(async (req, res) => {
  const device = await DeviceDay.findById(req.params.id);
  if (!device) throw ApiError.notFound('Device record not found');
  if (device.removedAt) throw ApiError.conflict('This device is already recorded as removed.');

  device.removedAt = req.body.removedAt;
  device.removalReason = req.body.removalReason || '';
  device.removedBy = req.user._id;
  device.updatedBy = req.user._id;
  await device.save();

  return sendResponse(res, {
    message: `Removed after ${device.deviceDays} device-day(s)`,
    data: device,
  });
});

export const reportHai = asyncHandler(async (req, res) => {
  const hai = await HaiCase.create({
    ...req.body,
    reportedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Infection reported', data: hai });
});

/**
 * Infection rates per 1,000 device-days.
 *
 * The denominator is the whole point: six CLABSIs means nothing without the
 * line-days behind it, because a unit running twice the lines sees twice the
 * infections at identical safety. Infections present on admission are excluded
 * — the patient brought those.
 */
export const infectionRates = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 90 * 86400000);
  const to = query.to ? new Date(query.to) : new Date();

  const devices = await DeviceDay.find({
    insertedAt: { $lte: to },
    $or: [{ removedAt: null }, { removedAt: { $gte: from } }],
    isActive: true,
  }).lean();

  const deviceDaysByType = {};
  for (const device of devices) {
    const start = new Date(Math.max(new Date(device.insertedAt), from));
    const end = new Date(Math.min(device.removedAt ? new Date(device.removedAt) : to, to));
    const days = Math.max(0, Math.ceil((end - start) / 86400000));
    deviceDaysByType[device.deviceType] = (deviceDaysByType[device.deviceType] || 0) + days;
  }

  const infections = await HaiCase.aggregate([
    { $match: { onsetDate: { $gte: from, $lte: to }, presentOnAdmission: false, isActive: true } },
    { $group: { _id: '$haiType', cases: { $sum: 1 }, mdr: { $sum: { $cond: ['$isMultiDrugResistant', 1, 0] } } } },
  ]);

  /** Which device denominator each infection type is measured against. */
  const DENOMINATOR = { clabsi: 'central-line', cauti: 'urinary-catheter', vap: 'ventilator' };

  return sendResponse(res, {
    data: {
      period: { from, to },
      deviceDays: deviceDaysByType,
      rates: infections.map((row) => {
        const denominator = deviceDaysByType[DENOMINATOR[row._id]] ?? null;
        return {
          haiType: row._id,
          cases: row.cases,
          multiDrugResistant: row.mdr,
          deviceDays: denominator,
          ratePer1000DeviceDays:
            denominator > 0 ? Math.round((row.cases / denominator) * 1000 * 100) / 100 : null,
        };
      }),
    },
    meta: {
      note: 'Infections present on admission are excluded — those were not acquired here.',
    },
  });
});

/**
 * The hospital's own antibiogram, built from its own culture results.
 *
 * Genuinely valuable and previously unbuildable despite the hospital already
 * holding every input: percent sensitive per organism per antibiotic, which is
 * what empirical prescribing should actually be based on.
 */
export const antibiogram = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 365 * 86400000);

  const rows = await HaiCase.aggregate([
    { $match: { onsetDate: { $gte: from }, organism: { $ne: '' }, isActive: true } },
    { $unwind: '$sensitivities' },
    {
      $group: {
        _id: { organism: '$organism', antibiotic: '$sensitivities.antibiotic' },
        total: { $sum: 1 },
        sensitive: { $sum: { $cond: [{ $eq: ['$sensitivities.result', 'sensitive'] }, 1, 0] } },
      },
    },
    { $sort: { '_id.organism': 1, '_id.antibiotic': 1 } },
  ]);

  const byOrganism = {};
  for (const row of rows) {
    const { organism, antibiotic } = row._id;
    byOrganism[organism] = byOrganism[organism] || [];
    byOrganism[organism].push({
      antibiotic,
      isolates: row.total,
      percentSensitive: Math.round((row.sensitive / row.total) * 100),
      // Below 30 isolates the percentage is too noisy to prescribe against, and
      // presenting it without that caveat invites exactly that.
      reliable: row.total >= 30,
    });
  }

  return sendResponse(res, {
    data: byOrganism,
    meta: {
      since: from,
      note: 'Percentages from fewer than 30 isolates are flagged unreliable — too few to prescribe against.',
    },
  });
});

export const orderIsolation = asyncHandler(async (req, res) => {
  const order = await IsolationOrder.create({
    ...req.body,
    orderedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Isolation ordered', data: order });
});

/** Active isolation orders — what the bed board must show before assigning. */
export const activeIsolations = asyncHandler(async (_req, res) => {
  const rows = await IsolationOrder.find({ endedAt: null, isActive: true })
    .populate({ path: 'patientId', select: 'mrn firstName lastName' })
    .sort({ startedAt: -1 })
    .lean();
  return sendResponse(res, { data: rows, meta: { total: rows.length } });
});

export const requestAntibiotic = asyncHandler(async (req, res) => {
  const drug = await Drug.findById(req.body.drugId).lean();
  if (!drug) throw ApiError.notFound('Drug not found');

  const approval = await AntibioticApproval.create({
    ...req.body,
    drugName: drug.name,
    requestedBy: req.user._id,
    // Access-tier agents are freely used; gating them teaches people to route
    // around the system without improving anything.
    status: req.body.tier === 'access' ? 'auto-approved' : 'requested',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message:
      approval.status === 'auto-approved'
        ? 'Access-tier antibiotic — no approval needed.'
        : 'Approval requested from the stewardship team.',
    data: approval,
  });
});

export const decideAntibiotic = asyncHandler(async (req, res) => {
  const approval = await AntibioticApproval.findById(req.params.id);
  if (!approval) throw ApiError.notFound('Request not found');
  if (approval.status !== 'requested') {
    throw ApiError.conflict(`This request is already ${approval.status}.`);
  }

  approval.status = req.body.status;
  approval.decidedBy = req.user._id;
  approval.decidedAt = new Date();
  approval.decisionNote = req.body.decisionNote || '';
  if (req.body.approvedDays) approval.approvedDays = req.body.approvedDays;
  approval.updatedBy = req.user._id;
  await approval.save();

  return sendResponse(res, {
    message: `Request ${approval.status}${approval.expiresAt ? ` until ${approval.expiresAt.toISOString().slice(0, 10)}` : ''}`,
    data: approval,
  });
});

export const listAntibioticRequests = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-requestedAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.tier ? { tier: query.tier } : null,
  );

  const [rows, total] = await Promise.all([
    AntibioticApproval.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'requestedBy decidedBy', select: 'firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    AntibioticApproval.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

/* ==========================================================================
 * B11 — INCIDENTS, REVIEW, COMPLAINTS
 * ======================================================================= */

export const listIncidents = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-occurredAt' });

  let range = null;
  if (query.from || query.to) {
    range = { occurredAt: {} };
    if (query.from) range.occurredAt.$gte = query.from;
    if (query.to) range.occurredAt.$lte = query.to;
  }

  const filter = andFilters(
    activeScope(query, req.user),
    query.category ? { category: query.category } : null,
    query.harmLevel ? { harmLevel: query.harmLevel } : null,
    query.status ? { status: query.status } : null,
    query.wardId ? { wardId: query.wardId } : null,
    range,
  );

  const [rows, total] = await Promise.all([
    IncidentReport.find(filter)
      // `reportedBy` is null on anonymous reports and populate handles that.
      .populate({ path: 'reportedBy investigatedBy', select: 'firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    IncidentReport.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const reportIncident = asyncHandler(async (req, res) => {
  const incident = await IncidentReport.create({
    ...req.body,
    // The model nulls this when isAnonymous is set; passing it is harmless.
    reportedBy: req.user._id,
    createdBy: req.body.isAnonymous ? null : req.user._id,
    updatedBy: req.body.isAnonymous ? null : req.user._id,
  });

  return sendCreated(res, {
    message: req.body.isAnonymous
      ? `Reported anonymously as ${incident.incidentNumber}. Your identity was not stored.`
      : `Reported as ${incident.incidentNumber}. Thank you.`,
    data: incident,
  });
});

export const investigateIncident = asyncHandler(async (req, res) => {
  const incident = await IncidentReport.findById(req.params.id);
  if (!incident) throw ApiError.notFound('Incident not found');

  Object.assign(incident, req.body);
  incident.investigatedBy = req.user._id;
  incident.investigationStartedAt = incident.investigationStartedAt || new Date();
  incident.status = req.body.actions?.length > 0 ? 'actions-agreed' : 'investigating';
  incident.updatedBy = req.user._id;
  await incident.save();

  return sendResponse(res, { message: 'Investigation recorded', data: incident });
});

/** Incident trends: what is happening repeatedly, and where. */
export const incidentTrends = asyncHandler(async (req, res) => {
  const from = getQuery(req).from ? new Date(getQuery(req).from) : new Date(Date.now() - 180 * 86400000);

  const [byCategory, byHarm, openActions] = await Promise.all([
    IncidentReport.aggregate([
      { $match: { occurredAt: { $gte: from }, isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    IncidentReport.aggregate([
      { $match: { occurredAt: { $gte: from }, isActive: true } },
      { $group: { _id: '$harmLevel', count: { $sum: 1 } } },
    ]),
    IncidentReport.countDocuments({
      'actions.completedAt': null,
      'actions.dueDate': { $lt: new Date() },
      isActive: true,
    }),
  ]);

  const total = byHarm.reduce((sum, r) => sum + r.count, 0);
  const nearMiss = byHarm.find((r) => r._id === 'near-miss')?.count ?? 0;

  return sendResponse(res, {
    data: { since: from, byCategory, byHarm, incidentsWithOverdueActions: openActions },
    meta: {
      total,
      /**
       * A healthy reporting culture produces far more near-misses than harm
       * events. A low ratio means under-reporting, not a safe hospital.
       */
      nearMissRatio: total > 0 ? Math.round((nearMiss / total) * 100) : null,
      note: 'A low near-miss share usually means under-reporting rather than safety.',
    },
  });
});

export const listComplaints = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-receivedAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.category ? { category: query.category } : null,
    query.status ? { status: query.status } : null,
    query.overdueOnly ? { resolvedAt: null, responseDueBy: { $lt: new Date() } } : null,
  );

  const [rows, total] = await Promise.all([
    Complaint.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Complaint.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createComplaint = asyncHandler(async (req, res) => {
  // A response standard, set on receipt rather than left open-ended.
  const responseDueBy = new Date();
  responseDueBy.setDate(responseDueBy.getDate() + 7);

  const complaint = await Complaint.create({
    ...req.body,
    receivedBy: req.user._id,
    responseDueBy,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: `Recorded as ${complaint.complaintNumber}. A response is due within 7 days.`,
    data: complaint,
  });
});

export const resolveComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound('Complaint not found');

  complaint.resolution = req.body.resolution;
  complaint.resolvedAt = new Date();
  complaint.status = 'resolved';
  if (req.body.complainantInformed) complaint.complainantInformedAt = new Date();
  if (req.body.complainantSatisfied !== undefined) {
    complaint.complainantSatisfied = req.body.complainantSatisfied;
  }
  complaint.updatedBy = req.user._id;
  await complaint.save();

  return sendResponse(res, {
    message: complaint.complainantInformedAt
      ? 'Complaint resolved and the complainant informed.'
      : 'Resolved — but the complainant has not yet been told, which is the part that counts.',
    data: complaint,
  });
});

/* ==========================================================================
 * C1 — REFERRALS
 * ======================================================================= */

function assertReferralTransition(from, to) {
  const allowed = REFERRAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot move a referral from "${from}" to "${to}".`, {
      code: 'INVALID_STATUS_TRANSITION',
    });
  }
}

export const listReferrals = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.direction ? { direction: query.direction } : null,
    query.status ? { status: query.status } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.urgency ? { urgency: query.urgency } : null,
    // The loop that never closed — sent out and never heard back.
    query.awaitingOutcome
      ? { direction: 'outbound', status: { $in: ['issued', 'acknowledged'] }, outcomeReceivedAt: null }
      : null,
    searchFilter(query.search, ['referralNumber', 'facilityName']),
  );

  const [rows, total] = await Promise.all([
    Referral.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'referredBy', select: 'firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Referral.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getReferral = asyncHandler(async (req, res) => {
  const referral = await Referral.findById(req.params.id)
    .populate({ path: 'patientId', select: 'mrn firstName lastName firstNameNe lastNameNe phone' })
    .populate({ path: 'referredBy outcomeRecordedBy', select: 'firstName lastName' });
  if (!referral) throw ApiError.notFound('Referral not found');
  return sendResponse(res, { data: referral });
});

export const createReferral = asyncHandler(async (req, res) => {
  const referral = await Referral.create({
    ...req.body,
    referredBy: req.user._id,
    // An inbound referral is a record of something that already happened, so it
    // is issued on arrival; an outbound one is drafted, then issued with a letter.
    status: req.body.direction === 'inbound' ? 'acknowledged' : 'draft',
    acknowledgedAt: req.body.direction === 'inbound' ? new Date() : null,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: `Referral ${referral.referralNumber} recorded`,
    data: referral,
  });
});

/** Issue an outbound referral — the point the letter is generated. */
export const issueReferral = asyncHandler(async (req, res) => {
  const referral = await Referral.findById(req.params.id);
  if (!referral) throw ApiError.notFound('Referral not found');
  assertReferralTransition(referral.status, 'issued');

  if (!referral.clinicalSummary) {
    throw ApiError.badRequest(
      'A referral letter needs a clinical summary — the receiving clinician has nothing else to go on.',
      { code: 'SUMMARY_REQUIRED' },
    );
  }

  referral.status = 'issued';
  referral.referredAt = new Date();
  referral.referredBy = req.user._id;
  referral.updatedBy = req.user._id;
  await referral.save();

  return sendResponse(res, { message: 'Referral issued', data: referral });
});

/**
 * Record what happened to a patient we sent away.
 *
 * The half every paper system loses: without it the referring clinician never
 * learns the outcome, the patient goes home with no follow-up plan, and the
 * referral can never be closed.
 */
export const recordOutcome = asyncHandler(async (req, res) => {
  const referral = await Referral.findById(req.params.id);
  if (!referral) throw ApiError.notFound('Referral not found');

  if (!['issued', 'acknowledged'].includes(referral.status)) {
    throw ApiError.conflict(`Cannot record an outcome on a ${referral.status} referral.`);
  }

  Object.assign(referral, req.body);
  referral.status = 'completed';
  referral.outcomeReceivedAt = new Date();
  referral.outcomeRecordedBy = req.user._id;
  referral.updatedBy = req.user._id;
  await referral.save();

  return sendResponse(res, { message: 'Outcome recorded — referral closed', data: referral });
});

/** Referrals sent out with no outcome, oldest first. */
export const openReferralLoop = asyncHandler(async (_req, res) => {
  const rows = await Referral.find({
    direction: 'outbound',
    status: { $in: ['issued', 'acknowledged'] },
    outcomeReceivedAt: null,
    isActive: true,
  })
    .populate({ path: 'patientId', select: 'mrn firstName lastName phone' })
    .sort({ referredAt: 1 })
    .limit(200)
    .lean({ virtuals: true });

  return sendResponse(res, {
    data: rows,
    meta: {
      total: rows.length,
      note: 'Each of these is a patient whose outcome the referring clinician never learned.',
    },
  });
});
