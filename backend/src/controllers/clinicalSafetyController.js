import {
  CriticalAlert,
  ControlledDrugRegister,
  MedicoLegalCase,
  DeathRecord,
  BirthRecord,
  Patient,
  Drug,
  Transfusion,
  TransfusionReaction,
  BloodUnit,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter } from '../utils/queryHelpers.js';
import * as terminology from '../services/terminologyService.js';
import * as critical from '../services/criticalResultService.js';

/* ==========================================================================
 * B1 — TERMINOLOGY
 * ======================================================================= */

export const searchCodes = asyncHandler(async (req, res) => {
  const { system, q, limit, includeNonLeaf } = getQuery(req);
  const results = await terminology.search({ system, query: q, limit, includeNonLeaf });
  return sendResponse(res, { data: results, meta: { system, query: q, count: results.length } });
});

export const validateCode = asyncHandler(async (req, res) => {
  const { system, code } = getQuery(req);
  const result = await terminology.validate({ system, code });
  return sendResponse(res, { data: result });
});

export const translateCode = asyncHandler(async (req, res) => {
  const { system, code, target } = getQuery(req);
  const result = await terminology.translate({ system, code, target });
  return sendResponse(res, {
    data: result,
    message: result ? undefined : 'No mapping exists between these systems for that code.',
  });
});

/** What is loaded, and what is not — the admin health view. */
export const terminologyStatus = asyncHandler(async (_req, res) => {
  const status = await terminology.installedSystems();
  return sendResponse(res, {
    data: status,
    meta: {
      note:
        status.missing.length > 0
          ? 'Coding against a system that is not installed is refused, never silently accepted. ' +
            'Load releases with scripts/importTerminology.js.'
          : undefined,
    },
  });
});

/* ==========================================================================
 * B4 — CRITICAL RESULTS
 * ======================================================================= */

export const criticalBoard = asyncHandler(async (req, res) => {
  const { includeAcknowledged } = getQuery(req);
  const board = await critical.outstandingBoard({ includeAcknowledged });
  return sendResponse(res, { data: board.alerts, meta: board.counts });
});

export const listAlerts = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-raisedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.unacknowledgedOnly ? { acknowledgedAt: null } : null,
  );

  const [rows, total] = await Promise.all([
    CriticalAlert.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'acknowledgedBy orderingClinicianId', select: 'firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    CriticalAlert.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const acknowledgeAlert = asyncHandler(async (req, res) => {
  const { alert, alreadyAcknowledged } = await critical.acknowledge({
    alertId: req.params.id,
    user: req.user,
    channel: req.body.channel || 'in-app',
    note: req.body.note || '',
  });

  return sendResponse(res, {
    message: alreadyAcknowledged
      ? `Already acknowledged by someone else at ${alert.acknowledgedAt.toISOString()}.`
      : 'Acknowledged — now record what was done.',
    data: alert,
  });
});

export const actionAlert = asyncHandler(async (req, res) => {
  const alert = await critical.recordAction({
    alertId: req.params.id,
    user: req.user,
    actionTaken: req.body.actionTaken,
  });
  return sendResponse(res, { message: 'Action recorded', data: alert });
});

/* ==========================================================================
 * B5 — CONTROLLED DRUG REGISTER
 * ======================================================================= */

export const listRegister = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  // Chronological, because that is how an inspector reads a register.
  const { page, limit, skip } = buildPagination({ ...query, sort: 'occurredAt' });

  let range = null;
  if (query.from || query.to) {
    range = { occurredAt: {} };
    if (query.from) range.occurredAt.$gte = query.from;
    if (query.to) range.occurredAt.$lte = query.to;
  }

  const filter = andFilters(
    query.wardId ? { wardId: query.wardId } : null,
    query.drugId ? { drugId: query.drugId } : null,
    query.schedule ? { schedule: query.schedule } : null,
    range,
  );

  const [rows, total] = await Promise.all([
    ControlledDrugRegister.find(filter)
      .populate({ path: 'performedBy witnessedBy', select: 'firstName lastName' })
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort({ occurredAt: 1 }).skip(skip).limit(limit).lean(),
    ControlledDrugRegister.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

/**
 * Write one register entry.
 *
 * The running balance is computed from the previous entry rather than supplied,
 * so a client cannot assert a balance that hides a discrepancy — which is the
 * entire point of the column.
 */
export const recordRegisterEntry = asyncHandler(async (req, res) => {
  const { wardId, drugId, quantity, entryType, countedQuantity } = req.body;

  const drug = await Drug.findById(drugId).lean();
  if (!drug) throw ApiError.notFound('Drug not found');
  if (!drug.schedule || drug.schedule === 'none') {
    throw ApiError.badRequest(
      `${drug.name} is not a controlled drug. Use the ordinary dispensing route.`,
      { code: 'NOT_CONTROLLED' },
    );
  }

  const last = await ControlledDrugRegister.findOne({ wardId, drugId })
    .sort({ occurredAt: -1, createdAt: -1 })
    .select('balanceAfter')
    .lean();

  const previousBalance = last?.balanceAfter ?? 0;
  const balanceAfter = previousBalance + quantity;

  if (balanceAfter < 0) {
    throw ApiError.conflict(
      `That would take the ward balance to ${balanceAfter}. The register shows ${previousBalance} in stock.`,
      { code: 'NEGATIVE_BALANCE', details: { previousBalance, requested: quantity } },
    );
  }

  const entry = await ControlledDrugRegister.create({
    ...req.body,
    drugName: drug.name,
    schedule: drug.schedule,
    balanceAfter,
    performedBy: req.user._id,
    performedByName: `${req.user.firstName} ${req.user.lastName}`.trim(),
    occurredAt: new Date(),
    // A physical count that disagrees with the register is the finding the
    // whole register exists to surface, so it is recorded on the entry itself.
    discrepancy:
      entryType === 'count-adjustment' && countedQuantity !== undefined
        ? { expected: previousBalance, counted: countedQuantity, investigated: false }
        : undefined,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: `Register entry recorded — ward balance is now ${balanceAfter}`,
    data: entry,
  });
});

/** Unreconciled discrepancies. The report nobody wants and everyone needs. */
export const registerDiscrepancies = asyncHandler(async (_req, res) => {
  const rows = await ControlledDrugRegister.find({
    'discrepancy.counted': { $ne: null },
    'discrepancy.investigated': false,
  })
    .populate({ path: 'performedBy witnessedBy', select: 'firstName lastName' })
    .sort({ occurredAt: -1 })
    .limit(200)
    .lean();

  return sendResponse(res, {
    data: rows,
    meta: { total: rows.length, note: 'Every one of these needs an explanation on the record.' },
  });
});

/* ==========================================================================
 * B6 — MEDICO-LEGAL
 * ======================================================================= */

export const listMlc = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-arrivedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.category ? { category: query.category } : null,
    query.status ? { status: query.status } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.awaitingPolice ? { policeInformedAt: null } : null,
    searchFilter(query.search, ['mlcNumber', 'firNumber']),
  );

  const [rows, total] = await Promise.all([
    MedicoLegalCase.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    MedicoLegalCase.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createMlc = asyncHandler(async (req, res) => {
  const existing = await MedicoLegalCase.findOne({ encounterId: req.body.encounterId, isActive: true });
  if (existing) {
    throw ApiError.conflict(`This encounter is already registered as ${existing.mlcNumber}.`, {
      code: 'MLC_EXISTS',
    });
  }

  const mlc = await MedicoLegalCase.create({
    ...req.body,
    arrivedAt: new Date(),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: `Registered as ${mlc.mlcNumber}. The police must now be informed.`,
    data: mlc,
  });
});

export const getMlc = asyncHandler(async (req, res) => {
  const mlc = await MedicoLegalCase.findById(req.params.id)
    .populate({ path: 'patientId', select: 'mrn firstName lastName firstNameNe lastNameNe' })
    .populate({ path: 'examinedBy policeInformedBy', select: 'firstName lastName' });
  if (!mlc) throw ApiError.notFound('Case not found');
  return sendResponse(res, { data: mlc });
});

export const informPolice = asyncHandler(async (req, res) => {
  const mlc = await MedicoLegalCase.findById(req.params.id);
  if (!mlc) throw ApiError.notFound('Case not found');

  Object.assign(mlc, req.body);
  mlc.policeInformedAt = new Date();
  mlc.policeInformedBy = req.user._id;
  mlc.status = 'police-informed';
  mlc.updatedBy = req.user._id;
  await mlc.save();

  return sendResponse(res, { message: 'Police intimation recorded', data: mlc });
});

/* ==========================================================================
 * B7 — DEATH AND BIRTH
 * ======================================================================= */

export const createDeath = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.body.patientId);
  if (!patient) throw ApiError.notFound('Patient not found');

  const existing = await DeathRecord.findOne({ patientId: req.body.patientId, isActive: true });
  if (existing) throw ApiError.conflict(`A death record already exists (${existing.deathRecordNumber}).`);

  const record = await DeathRecord.create({
    ...req.body,
    pronouncedBy: req.user._id,
    pronouncedAt: new Date(),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  // The chart must reflect it, or the patient stays bookable for appointments.
  patient.status = 'deceased';
  patient.updatedBy = req.user._id;
  await patient.save();

  return sendCreated(res, {
    message: `Death recorded as ${record.deathRecordNumber}. The cause of death still needs certifying.`,
    data: record,
  });
});

/**
 * Certify the cause of death.
 *
 * Separated from recording the death because they are different acts by
 * potentially different people: a nurse or duty doctor pronounces, and a doctor
 * with the case knowledge certifies. The model refuses a mode of dying as the
 * underlying cause.
 */
export const certifyDeath = asyncHandler(async (req, res) => {
  const record = await DeathRecord.findById(req.params.id);
  if (!record) throw ApiError.notFound('Death record not found');
  if (record.certifiedAt) throw ApiError.conflict('This death has already been certified.');

  if (!req.user.hasValidRegistration?.()) {
    throw ApiError.conflict(
      'A lapsed or missing council registration cannot certify a cause of death.',
      { code: 'REGISTRATION_INVALID' },
    );
  }

  Object.assign(record, req.body);
  record.certifiedBy = req.user._id;
  record.certifiedAt = new Date();
  record.certifierRegistration = req.user.councilRegistration?.number || '';
  record.updatedBy = req.user._id;
  await record.save();

  return sendResponse(res, {
    message: `Certified. Underlying cause: ${record.underlyingCauseText}`,
    data: record,
  });
});

export const listDeaths = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-diedAt' });
  const filter = andFilters(activeScope(query, req.user), query.reviewRequired ? { reviewRequired: true } : null);

  const [rows, total] = await Promise.all([
    DeathRecord.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    DeathRecord.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createBirth = asyncHandler(async (req, res) => {
  const record = await BirthRecord.create({
    ...req.body,
    attendedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Birth recorded as ${record.birthRecordNumber}`, data: record });
});

export const listBirths = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-bornAt' });
  const filter = activeScope(query, req.user);

  const [rows, total] = await Promise.all([
    BirthRecord.find(filter)
      .populate({ path: 'motherPatientId babyPatientId', select: 'mrn firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    BirthRecord.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

/* ==========================================================================
 * B10 — TRANSFUSION
 * ======================================================================= */

export const prepareTransfusion = asyncHandler(async (req, res) => {
  const [patient, unit] = await Promise.all([
    Patient.findById(req.body.patientId).lean(),
    BloodUnit.findById(req.body.bloodUnitId).lean(),
  ]);
  if (!patient) throw ApiError.notFound('Patient not found');
  if (!unit) throw ApiError.notFound('Blood unit not found');

  if (unit.status !== 'available' && unit.status !== 'reserved') {
    throw ApiError.conflict(`That unit is ${unit.status} and cannot be issued.`);
  }
  if (new Date(unit.expiresAt) < new Date()) {
    throw ApiError.conflict('That unit has expired.', { code: 'UNIT_EXPIRED' });
  }

  const transfusion = await Transfusion.create({
    ...req.body,
    bagNumber: unit.bagNumber,
    component: unit.component,
    unitBloodGroup: unit.group,
    patientBloodGroup: patient.bloodGroup,
    status: 'prepared',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: 'Unit issued. Two people must complete the bedside check before it is started.',
    data: transfusion,
  });
});

/**
 * The bedside check, then start.
 *
 * Both signatures arrive in one request because they happen together at the
 * bedside — but they are two different people, and the model refuses if they
 * are the same. This is the last barrier before an ABO-incompatible unit runs.
 */
export const checkAndStart = asyncHandler(async (req, res) => {
  const transfusion = await Transfusion.findById(req.params.id);
  if (!transfusion) throw ApiError.notFound('Transfusion not found');
  if (transfusion.status !== 'prepared') {
    throw ApiError.conflict(`This transfusion is already ${transfusion.status}.`);
  }

  const { witnessedBy, checks } = req.body;
  const witness = await import('../models/index.js').then((m) => m.User.findById(witnessedBy).lean());
  if (!witness) throw ApiError.badRequest('The witness is not a known user.');

  transfusion.checkedBy = req.user._id;
  transfusion.checkedByName = `${req.user.firstName} ${req.user.lastName}`.trim();
  transfusion.witnessedBy = witnessedBy;
  transfusion.witnessedByName = `${witness.firstName} ${witness.lastName}`.trim();
  transfusion.checkedAt = new Date();
  transfusion.bedsideChecks = { ...checks };
  transfusion.status = 'in-progress';
  transfusion.startedAt = new Date();
  transfusion.updatedBy = req.user._id;

  await transfusion.save();

  return sendResponse(res, {
    message: 'Bedside check complete — transfusion started. Observe at 15 minutes.',
    data: transfusion,
  });
});

export const addObservation = asyncHandler(async (req, res) => {
  const transfusion = await Transfusion.findById(req.params.id);
  if (!transfusion) throw ApiError.notFound('Transfusion not found');

  transfusion.observations.push({ ...req.body, recordedBy: req.user._id, recordedAt: new Date() });
  transfusion.updatedBy = req.user._id;
  await transfusion.save();

  return sendResponse(res, { message: 'Observation recorded', data: transfusion });
});

export const reportReaction = asyncHandler(async (req, res) => {
  const transfusion = await Transfusion.findById(req.params.id);
  if (!transfusion) throw ApiError.notFound('Transfusion not found');

  const reaction = await TransfusionReaction.create({
    ...req.body,
    transfusionId: transfusion._id,
    patientId: transfusion.patientId,
    bloodUnitId: transfusion.bloodUnitId,
    reportedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  // A reaction stops the transfusion. Recording one while it keeps running
  // would be a contradiction the record should not permit.
  transfusion.hadReaction = true;
  if (transfusion.status === 'in-progress') {
    transfusion.status = 'stopped';
    transfusion.stoppedAt = new Date();
    transfusion.stopReason = `Reaction: ${reaction.reactionType}`;
  }
  transfusion.updatedBy = req.user._id;
  await transfusion.save();

  return sendCreated(res, {
    message: `Reaction ${reaction.reactionNumber} reported and the transfusion stopped. Return the unit to the bank.`,
    data: reaction,
  });
});

export const listTransfusions = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.status ? { status: query.status } : null,
  );

  const [rows, total] = await Promise.all([
    Transfusion.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Transfusion.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});
