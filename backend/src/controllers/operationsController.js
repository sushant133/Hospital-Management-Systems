import {
  OpdToken,
  QueueCounter,
  Ambulance,
  AmbulanceTrip,
  DialysisMachine,
  DialysisSession,
  PatientFile,
  RecordRelease,
  CodingTask,
  DietOrder,
  HousekeepingTask,
  WasteLog,
  SterilisationCycle,
  InstrumentSet,
  Asset,
  MaintenanceTask,
  TherapyCourse,
  TherapySession,
  MortuaryRecord,
  Teleconsultation,
  Encounter,
  Patient,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter } from '../utils/queryHelpers.js';

/** Midnight today, in the server's zone — the queue and rota day boundary. */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const list = (Model) =>
  asyncHandler(async (req, res) => {
    const query = getQuery(req);
    const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });
    const filter = activeScope(query, req.user);
    const [rows, total] = await Promise.all([
      Model.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
      Model.countDocuments(filter),
    ]);
    return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
  });

/* ==========================================================================
 * C2 — OPD QUEUE
 * ======================================================================= */

/**
 * Issue a token.
 *
 * The sequence is per band, not global: a priority patient gets P-004, not a
 * rewritten normal number. Renumbering someone would be invisible to everyone
 * waiting and would look exactly like queue-jumping for a bribe.
 */
export const issueToken = asyncHandler(async (req, res) => {
  const { patientId, departmentId, doctorId, priority = 'normal', priorityReason = '' } = req.body;
  const queueDate = startOfToday();

  const patient = await Patient.findById(patientId).lean();
  if (!patient) throw ApiError.notFound('Patient not found');

  const existing = await OpdToken.findOne({
    queueDate, departmentId, patientId,
    status: { $nin: ['cancelled', 'no-show'] },
  });
  if (existing) {
    return sendResponse(res, {
      message: `This patient already holds token ${existing.tokenNumber} today.`,
      data: existing,
    });
  }

  const last = await OpdToken.findOne({ queueDate, departmentId, priority })
    .sort({ sequence: -1 })
    .select('sequence')
    .lean();

  const sequence = (last?.sequence ?? 0) + 1;
  const prefix = { emergency: 'E', priority: 'P', normal: 'N' }[priority];

  const token = await OpdToken.create({
    tokenNumber: `${prefix}-${String(sequence).padStart(3, '0')}`,
    sequence,
    priority,
    priorityReason,
    queueDate,
    departmentId,
    doctorId: doctorId ?? null,
    patientId,
    appointmentId: req.body.appointmentId ?? null,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, { message: `Token ${token.tokenNumber} issued`, data: token });
});

/**
 * Call the next patient.
 *
 * Interleaves priority into the normal queue at a fixed ratio rather than
 * giving it absolute precedence — unlimited precedence lets a steady trickle of
 * priority patients starve the general queue for the whole day, which is how a
 * fair-looking rule produces an unfair morning.
 */
export const callNext = asyncHandler(async (req, res) => {
  const { departmentId, counterName } = req.body;
  const queueDate = startOfToday();

  const counter = await QueueCounter.findOneAndUpdate(
    { queueDate, departmentId, counterName },
    { $setOnInsert: { queueDate, departmentId, counterName, createdBy: req.user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const pick = async (priority) =>
    OpdToken.findOne({ queueDate, departmentId, priority, status: 'waiting' })
      .sort({ sequence: 1 })
      .populate({ path: 'patientId', select: 'mrn firstName lastName firstNameNe lastNameNe' });

  // Emergency always first — it is not part of the ratio.
  let next = await pick('emergency');
  let band = 'emergency';

  if (!next) {
    const priorityDue = counter.sinceLastPriority >= counter.priorityRatio;
    next = priorityDue ? await pick('priority') : null;
    band = next ? 'priority' : null;

    if (!next) {
      next = await pick('normal');
      band = 'normal';
      // Nothing normal left — take a priority patient rather than idling.
      if (!next) {
        next = await pick('priority');
        band = next ? 'priority' : null;
      }
    }
  }

  if (!next) {
    return sendResponse(res, { message: 'The queue is empty.', data: { token: null, counter } });
  }

  next.status = 'called';
  next.calledAt = new Date();
  next.callCount += 1;
  next.calledBy = req.user._id;
  next.counterName = counterName;
  await next.save();

  counter.nowServing = next.tokenNumber;
  counter.nowServingTokenId = next._id;
  counter.lastCalledAt = new Date();
  counter.sinceLastPriority = band === 'normal' ? counter.sinceLastPriority + 1 : 0;
  await counter.save();

  return sendResponse(res, {
    message: `Now serving ${next.tokenNumber}`,
    data: { token: next, counter },
    meta: { band },
  });
});

/**
 * The public display board.
 *
 * Unauthenticated in spirit — it runs on a TV in the waiting hall — so it
 * returns token numbers and counters only. No patient names, ever: a waiting
 * room full of strangers must not learn who is being seen for what.
 */
export const displayBoard = asyncHandler(async (req, res) => {
  const queueDate = startOfToday();
  const { departmentId } = getQuery(req);

  const filter = { queueDate, ...(departmentId ? { departmentId } : {}) };

  const [counters, waiting] = await Promise.all([
    QueueCounter.find({ ...filter, isOpen: true })
      .populate({ path: 'departmentId', select: 'name nameNe' })
      .lean(),
    OpdToken.find({ ...filter, status: 'waiting' })
      .select('tokenNumber priority departmentId')
      .sort({ priority: 1, sequence: 1 })
      .limit(40)
      .lean(),
  ]);

  return sendResponse(res, {
    data: {
      nowServing: counters.map((c) => ({
        counter: c.counterName,
        department: c.departmentId?.name ?? '',
        token: c.nowServing,
        at: c.lastCalledAt,
      })),
      // Numbers only — no identifying detail leaves this endpoint.
      upcoming: waiting.map((t) => ({ token: t.tokenNumber, priority: t.priority })),
    },
    meta: { waitingCount: waiting.length, asOf: new Date() },
  });
});

/** Mark the outcome of a call: started, deferred, or a no-show. */
export const updateToken = asyncHandler(async (req, res) => {
  const token = await OpdToken.findById(req.params.id);
  if (!token) throw ApiError.notFound('Token not found');

  const { status } = req.body;

  // A first miss defers rather than discards: someone paying a bill or in the
  // toilet should lose their place in the queue, not their place in the day.
  if (status === 'no-show' && token.callCount < 2) {
    token.status = 'deferred';
    token.notes = 'Absent on first call — deferred to the back of the queue.';
  } else {
    token.status = status;
  }

  if (status === 'in-consultation') token.startedAt = new Date();
  if (status === 'completed') token.completedAt = new Date();
  token.updatedBy = req.user._id;
  await token.save();

  return sendResponse(res, {
    message: token.status === 'deferred' ? 'Deferred — will be called again.' : `Token ${token.status}`,
    data: token,
  });
});

/* ==========================================================================
 * C3 — AMBULANCE
 * ======================================================================= */

export const listAmbulances = list(Ambulance);

export const dispatchTrip = asyncHandler(async (req, res) => {
  const ambulance = await Ambulance.findById(req.body.ambulanceId);
  if (!ambulance) throw ApiError.notFound('Ambulance not found');
  if (ambulance.status !== 'available') {
    throw ApiError.conflict(`${ambulance.vehicleNumber} is ${ambulance.status}.`);
  }

  const trip = await AmbulanceTrip.create({
    ...req.body,
    vehicleNumber: ambulance.vehicleNumber,
    requestedBy: req.user._id,
    status: 'dispatched',
    dispatchedAt: new Date(),
    odometerStartKm: ambulance.currentOdometerKm,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  ambulance.status = 'dispatched';
  ambulance.updatedBy = req.user._id;
  await ambulance.save();

  return sendCreated(res, {
    message: `${ambulance.vehicleNumber} dispatched as ${trip.tripNumber}`,
    data: trip,
    // A vehicle with lapsed paperwork is still dispatched in an emergency —
    // the dispatcher is told, and decides.
    meta: { complianceIssues: ambulance.complianceIssues },
  });
});

export const updateTrip = asyncHandler(async (req, res) => {
  const trip = await AmbulanceTrip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');

  Object.assign(trip, req.body);
  trip.updatedBy = req.user._id;
  await trip.save();

  // Completing a trip returns the vehicle and advances its odometer.
  if (['completed', 'cancelled', 'aborted'].includes(trip.status)) {
    const ambulance = await Ambulance.findById(trip.ambulanceId);
    if (ambulance) {
      ambulance.status = 'available';
      if (trip.odometerEndKm != null) ambulance.currentOdometerKm = trip.odometerEndKm;
      ambulance.updatedBy = req.user._id;
      await ambulance.save();
    }
  }

  return sendResponse(res, { message: 'Trip updated', data: trip });
});

export const listTrips = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-requestedAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.ambulanceId ? { ambulanceId: query.ambulanceId } : null,
  );
  const [rows, total] = await Promise.all([
    AmbulanceTrip.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    AmbulanceTrip.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

/* ==========================================================================
 * C4 — DIALYSIS
 * ======================================================================= */

export const listMachines = list(DialysisMachine);

/**
 * Schedule a session onto a machine.
 *
 * The serology check is the one that matters: placing a hepatitis-B positive
 * patient on a general machine is a cross-infection event, so the mismatch is
 * refused rather than warned about.
 */
export const scheduleDialysis = asyncHandler(async (req, res) => {
  const { machineId, patientId, scheduledFor } = req.body;

  if (machineId) {
    const machine = await DialysisMachine.findById(machineId).lean();
    if (!machine) throw ApiError.notFound('Machine not found');
    if (machine.status === 'maintenance' || machine.status === 'retired') {
      throw ApiError.conflict(`Machine ${machine.machineCode} is ${machine.status}.`);
    }

    const clash = await DialysisSession.findOne({
      machineId,
      status: { $in: ['scheduled', 'in-progress'] },
      scheduledFor: {
        $gte: new Date(new Date(scheduledFor).getTime() - 4 * 3600000),
        $lte: new Date(new Date(scheduledFor).getTime() + 4 * 3600000),
      },
    }).lean();
    if (clash) {
      throw ApiError.conflict(
        `Machine ${machine.machineCode} already has a session at ${new Date(clash.scheduledFor).toISOString()}.`,
        { code: 'MACHINE_BUSY' },
      );
    }
  }

  const session = await DialysisSession.create({
    ...req.body,
    patientId,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Session ${session.sessionNumber} scheduled`, data: session });
});

export const recordDialysisSession = asyncHandler(async (req, res) => {
  const session = await DialysisSession.findById(req.params.id);
  if (!session) throw ApiError.notFound('Session not found');

  Object.assign(session, req.body);
  session.performedBy = session.performedBy || req.user._id;
  session.updatedBy = req.user._id;
  await session.save();

  const warnings = [];
  if (session.wasShortened) warnings.push('Session was cut short of the prescribed time.');
  if (session.dialyserOverReused) warnings.push('Dialyser is past its reuse limit.');

  return sendResponse(res, { message: 'Session recorded', data: session, meta: { warnings } });
});

/** Sessions delivered but never claimed — money the hospital is owed. */
export const unclaimedDialysis = asyncHandler(async (_req, res) => {
  const rows = await DialysisSession.find({ status: 'completed', schemeClaimId: null, isActive: true })
    .populate({ path: 'patientId', select: 'mrn firstName lastName' })
    .sort({ scheduledFor: 1 })
    .limit(300)
    .lean();
  return sendResponse(res, {
    data: rows,
    meta: { total: rows.length, note: 'Each of these is a free-dialysis session that has not been claimed.' },
  });
});

/* ==========================================================================
 * C5 — MEDICAL RECORDS
 * ======================================================================= */

export const moveFile = asyncHandler(async (req, res) => {
  const { patientId, to, purpose, dueBack } = req.body;

  const file = await PatientFile.findOneAndUpdate(
    { patientId },
    { $setOnInsert: { patientId, fileNumber: req.body.fileNumber || String(patientId).slice(-8), createdBy: req.user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  file.movements.push({
    from: file.currentLocation,
    to,
    movedBy: req.user._id,
    purpose: purpose || '',
  });
  file.currentLocation = to;
  file.heldBy = to === 'mrd-shelf' ? null : req.user._id;
  file.heldByName = to === 'mrd-shelf' ? '' : `${req.user.firstName} ${req.user.lastName}`.trim();
  file.issuedAt = to === 'mrd-shelf' ? null : new Date();
  file.dueBack = to === 'mrd-shelf' ? null : dueBack || null;
  file.updatedBy = req.user._id;
  await file.save();

  return sendResponse(res, { message: `File moved to ${to}`, data: file });
});

/** Files out of the MRD past their return date. */
export const overdueFiles = asyncHandler(async (_req, res) => {
  const rows = await PatientFile.find({
    currentLocation: { $ne: 'mrd-shelf' },
    dueBack: { $ne: null, $lt: new Date() },
    isActive: true,
  })
    .populate({ path: 'patientId', select: 'mrn firstName lastName' })
    .sort({ dueBack: 1 })
    .lean({ virtuals: true });
  return sendResponse(res, { data: rows, meta: { total: rows.length } });
});

export const createReleaseRequest = asyncHandler(async (req, res) => {
  const request = await RecordRelease.create({
    ...req.body,
    receivedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Request ${request.requestNumber} logged`, data: request });
});

/**
 * Approve or refuse a release.
 *
 * The model refuses approval without consent or a legal basis, so this is the
 * decision, not the check — which is the right way round.
 */
export const decideRelease = asyncHandler(async (req, res) => {
  const request = await RecordRelease.findById(req.params.id);
  if (!request) throw ApiError.notFound('Request not found');

  Object.assign(request, req.body);
  request.decidedBy = req.user._id;
  request.decidedAt = new Date();
  request.updatedBy = req.user._id;
  await request.save();

  return sendResponse(res, { message: `Request ${request.status}`, data: request });
});

export const listReleases = list(RecordRelease);

/**
 * The coding worklist.
 *
 * This is where B1's ICD work bites. Coding is deliberately not enforced at the
 * point of care; it is enforced here, where the coder works — and until an
 * encounter is coded, its diagnoses cannot appear in the HMIS morbidity table.
 */
export const codingWorklist = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: 'dischargedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : { status: { $in: ['pending', 'in-progress', 'queried'] } },
    query.assignedTo ? { assignedTo: query.assignedTo } : null,
  );

  const [rows, total] = await Promise.all([
    CodingTask.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort({ dischargedAt: 1 })
      .skip(skip).limit(limit).lean({ virtuals: true }),
    CodingTask.countDocuments(filter),
  ]);

  return sendResponse(res, {
    data: rows,
    meta: {
      ...buildMeta({ page, limit, total }),
      note: 'Uncoded encounters are excluded from the HMIS morbidity table.',
    },
  });
});

/**
 * Complete a coding task, recounting from the encounter itself.
 *
 * The counts are re-derived rather than trusted from the request: a coder
 * marking their own work complete without the diagnoses actually being coded is
 * exactly the failure this queue exists to prevent.
 */
export const completeCoding = asyncHandler(async (req, res) => {
  const task = await CodingTask.findById(req.params.id);
  if (!task) throw ApiError.notFound('Coding task not found');

  const encounter = await Encounter.findById(task.encounterId).select('diagnosis').lean();
  if (!encounter) throw ApiError.notFound('Encounter not found');

  const diagnoses = encounter.diagnosis || [];
  const coded = diagnoses.filter((d) => d.concept?.code);

  task.diagnosisCount = diagnoses.length;
  task.codedDiagnosisCount = coded.length;
  task.codedBy = req.user._id;
  task.codedAt = new Date();
  task.updatedBy = req.user._id;

  if (diagnoses.length === 0) {
    throw ApiError.conflict('This encounter has no diagnosis recorded at all — query the clinician.', {
      code: 'NO_DIAGNOSIS',
    });
  }
  if (coded.length < diagnoses.length) {
    task.status = 'in-progress';
    await task.save();
    return sendResponse(res, {
      message: `${coded.length} of ${diagnoses.length} diagnoses are coded — still incomplete.`,
      data: task,
    });
  }

  task.status = 'complete';
  await task.save();
  return sendResponse(res, { message: 'Coding complete', data: task });
});

/* ==========================================================================
 * C6 / C9 — DIET, HOUSEKEEPING, WASTE
 * ======================================================================= */

export const orderDiet = asyncHandler(async (req, res) => {
  // Allergies are copied onto the order so the kitchen never needs a join to
  // avoid killing someone, and the tray card carries them.
  const patient = await Patient.findById(req.body.patientId).select('medicalHistory').lean();
  const allergies = (patient?.medicalHistory?.allergies || []).map((a) => a.substance);

  // A previous active order is superseded, not duplicated.
  await DietOrder.updateMany(
    { encounterId: req.body.encounterId, discontinuedAt: null },
    { $set: { discontinuedAt: new Date(), discontinuedBy: req.user._id } },
  );

  const order = await DietOrder.create({
    ...req.body,
    allergies,
    orderedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, { message: `${order.dietType} diet ordered`, data: order });
});

/**
 * The kitchen's meal count.
 *
 * Honours nil-by-mouth automatically, which is the entire reason it is computed
 * rather than phoned through: a patient fed at 6am for an 8am list has their
 * operation cancelled.
 */
export const kitchenCount = asyncHandler(async (req, res) => {
  const { meal = 'lunch' } = getQuery(req);
  const at = new Date();

  const orders = await DietOrder.find({ discontinuedAt: null, isActive: true })
    .populate({ path: 'wardId', select: 'name' })
    .lean();

  const counts = {};
  let nilByMouth = 0;

  for (const order of orders) {
    if (!(order.meals || []).includes(meal)) continue;

    const feedable =
      order.dietType !== 'nil-by-mouth' &&
      !(order.nilByMouthFrom && new Date(order.nilByMouthFrom) <= at);

    if (!feedable) {
      nilByMouth += 1;
      continue;
    }

    const ward = order.wardId?.name || 'unassigned';
    counts[ward] = counts[ward] || {};
    counts[ward][order.dietType] = (counts[ward][order.dietType] || 0) + 1;
  }

  return sendResponse(res, {
    data: { meal, byWard: counts },
    meta: {
      nilByMouthExcluded: nilByMouth,
      note: 'Nil-by-mouth patients are excluded automatically, including those made NBM for theatre.',
    },
  });
});

export const raiseHousekeepingTask = asyncHandler(async (req, res) => {
  const task = await HousekeepingTask.create({
    ...req.body,
    raisedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Task raised', data: task });
});

export const updateHousekeepingTask = asyncHandler(async (req, res) => {
  const task = await HousekeepingTask.findById(req.params.id);
  if (!task) throw ApiError.notFound('Task not found');

  const { status } = req.body;
  Object.assign(task, req.body);

  if (status === 'in-progress' && !task.startedAt) task.startedAt = new Date();
  if (status === 'completed') {
    task.completedAt = new Date();
    task.completedBy = req.user._id;
  }
  if (status === 'verified') {
    task.verifiedAt = new Date();
    task.verifiedBy = req.user._id;
  }
  task.updatedBy = req.user._id;
  await task.save();

  return sendResponse(res, {
    message: `Task ${task.status}`,
    data: task,
    meta: { turnaroundMinutes: task.turnaroundMinutes },
  });
});

export const listHousekeeping = list(HousekeepingTask);

export const recordWaste = asyncHandler(async (req, res) => {
  const log = await WasteLog.create({
    ...req.body,
    collectedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Waste recorded', data: log });
});

/** Waste by category, and segregation breaches — what an inspector asks for. */
export const wasteReport = asyncHandler(async (req, res) => {
  const from = getQuery(req).from ? new Date(getQuery(req).from) : new Date(Date.now() - 30 * 86400000);

  const [byCategory, breaches] = await Promise.all([
    WasteLog.aggregate([
      { $match: { collectedAt: { $gte: from }, isActive: true } },
      { $group: { _id: '$category', totalKg: { $sum: '$weightKg' }, collections: { $sum: 1 } } },
      { $sort: { totalKg: -1 } },
    ]),
    WasteLog.countDocuments({ collectedAt: { $gte: from }, segregationBreach: true, isActive: true }),
  ]);

  const total = byCategory.reduce((s, r) => s + r.totalKg, 0);

  return sendResponse(res, {
    data: {
      since: from,
      byCategory: byCategory.map((r) => ({
        category: r._id,
        totalKg: Math.round(r.totalKg * 100) / 100,
        collections: r.collections,
        percentOfTotal: total > 0 ? Math.round((r.totalKg / total) * 100) : 0,
      })),
      segregationBreaches: breaches,
    },
    meta: {
      note:
        'Infectious waste well above ~15% of the total usually means poor segregation, ' +
        'not a sicker hospital — general waste is going into red bags.',
    },
  });
});

/* ==========================================================================
 * C7 / C8 — CSSD AND ASSETS
 * ======================================================================= */

export const runCycle = asyncHandler(async (req, res) => {
  const cycle = await SterilisationCycle.create({
    ...req.body,
    operatedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Cycle ${cycle.cycleNumber} started`, data: cycle });
});

/**
 * Read the biological indicator and release or quarantine the load.
 *
 * A failure quarantines every set in the load, not just the cycle record —
 * leaving that to a human is how contaminated instruments reach a theatre.
 */
export const readIndicator = asyncHandler(async (req, res) => {
  const cycle = await SterilisationCycle.findById(req.params.id);
  if (!cycle) throw ApiError.notFound('Cycle not found');

  cycle.biologicalIndicator = req.body.biologicalIndicator;
  cycle.biologicalReadAt = new Date();
  cycle.biologicalReadBy = req.user._id;
  cycle.updatedBy = req.user._id;

  if (cycle.biologicalIndicator === 'pass') {
    cycle.status = 'released';
  }
  await cycle.save();

  let quarantined = 0;
  if (cycle.biologicalIndicator === 'fail') {
    const result = await InstrumentSet.updateMany(
      { lastCycleId: cycle._id, status: { $in: ['sterile', 'issued'] } },
      { $set: { status: 'quarantined', updatedBy: req.user._id } },
    );
    quarantined = result.modifiedCount ?? 0;
  }

  return sendResponse(res, {
    message:
      cycle.biologicalIndicator === 'fail'
        ? `Load QUARANTINED — ${quarantined} set(s) withdrawn from use. Recall anything already issued.`
        : 'Load released',
    data: cycle,
    meta: { setsQuarantined: quarantined },
  });
});

export const listAssets = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    searchFilter(query.search, ['assetTag', 'name', 'serialNumber']),
  );
  const [rows, total] = await Promise.all([
    Asset.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Asset.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const reportFault = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.body.assetId);
  if (!asset) throw ApiError.notFound('Asset not found');

  const task = await MaintenanceTask.create({
    ...req.body,
    maintenanceType: req.body.maintenanceType || 'corrective',
    reportedBy: req.user._id,
    downtimeStartedAt: req.body.assetOutOfService ? new Date() : null,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  if (req.body.assetOutOfService) {
    asset.status = 'under-repair';
    asset.updatedBy = req.user._id;
    await asset.save();
  }

  return sendCreated(res, { message: `Ticket ${task.ticketNumber} raised`, data: task });
});

export const completeMaintenance = asyncHandler(async (req, res) => {
  const task = await MaintenanceTask.findById(req.params.id);
  if (!task) throw ApiError.notFound('Ticket not found');

  Object.assign(task, req.body);
  task.status = 'completed';
  task.completedAt = new Date();
  if (task.downtimeStartedAt && !task.downtimeEndedAt) task.downtimeEndedAt = new Date();
  task.updatedBy = req.user._id;
  await task.save();

  const asset = await Asset.findById(task.assetId);
  if (asset) {
    asset.status = 'in-service';
    asset.lastServicedAt = new Date();
    if (task.nextServiceDue) asset.nextServiceDue = task.nextServiceDue;
    // Downtime accumulates on the asset, which is what answers "why was the CT
    // unavailable" months later.
    if (task.downtimeHours) asset.totalDowntimeHours += task.downtimeHours;
    asset.updatedBy = req.user._id;
    await asset.save();
  }

  return sendResponse(res, { message: 'Maintenance completed', data: task });
});

/** Everything overdue: service, calibration, AMC. */
export const assetsDue = asyncHandler(async (_req, res) => {
  const now = new Date();
  const rows = await Asset.find({
    status: { $nin: ['condemned', 'disposed'] },
    isActive: true,
    $or: [
      { nextServiceDue: { $ne: null, $lt: now } },
      { calibrationRequired: true, calibrationExpiry: { $ne: null, $lt: now } },
      { amcExpiry: { $ne: null, $lt: now } },
    ],
  })
    .sort({ nextServiceDue: 1 })
    .lean({ virtuals: true });

  return sendResponse(res, {
    data: rows,
    meta: {
      total: rows.length,
      note: 'A result from an out-of-calibration analyser is questionable — that is more urgent than a missed service.',
    },
  });
});

/* ==========================================================================
 * C10 / C11 / C12
 * ======================================================================= */

export const createTherapyCourse = asyncHandler(async (req, res) => {
  const course = await TherapyCourse.create({
    ...req.body,
    referredBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Course ${course.courseNumber} opened`, data: course });
});

export const recordTherapySession = asyncHandler(async (req, res) => {
  const course = await TherapyCourse.findById(req.body.courseId);
  if (!course) throw ApiError.notFound('Course not found');

  const session = await TherapySession.create({
    ...req.body,
    patientId: course.patientId,
    therapistId: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  if (session.status === 'attended') {
    course.sessionsAttended += 1;
    if (session.scoreThisSession != null) course.currentScore = session.scoreThisSession;
    course.updatedBy = req.user._id;
    await course.save();
  }

  return sendCreated(res, {
    message: 'Session recorded',
    data: session,
    meta: { sessionsAttended: course.sessionsAttended, improvement: course.improvement },
  });
});

export const listTherapyCourses = list(TherapyCourse);

export const receiveBody = asyncHandler(async (req, res) => {
  const record = await MortuaryRecord.create({
    ...req.body,
    receivedBy: req.user._id,
    status: 'in-storage',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Received as ${record.recordNumber}`, data: record });
});

/**
 * Release a body.
 *
 * The model enforces identity, a witness, and police clearance for an MLC.
 * The controller only supplies the acting user — every guard that matters lives
 * where no code path can bypass it.
 */
export const releaseBody = asyncHandler(async (req, res) => {
  const record = await MortuaryRecord.findById(req.params.id);
  if (!record) throw ApiError.notFound('Record not found');
  if (record.status === 'released') throw ApiError.conflict('This body has already been released.');

  Object.assign(record, req.body);
  record.status = 'released';
  record.releasedAt = new Date();
  record.releasedBy = req.user._id;
  record.updatedBy = req.user._id;
  await record.save();

  return sendResponse(res, {
    message: `Released to ${record.releasedTo} after ${record.storageDays} day(s)`,
    data: record,
  });
});

export const listMortuary = list(MortuaryRecord);

export const scheduleTeleconsultation = asyncHandler(async (req, res) => {
  const consult = await Teleconsultation.create({
    ...req.body,
    status: 'scheduled',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Scheduled as ${consult.consultationNumber}`, data: consult });
});

export const updateTeleconsultation = asyncHandler(async (req, res) => {
  const consult = await Teleconsultation.findById(req.params.id);
  if (!consult) throw ApiError.notFound('Consultation not found');

  Object.assign(consult, req.body);
  if (req.body.status === 'in-progress' && !consult.startedAt) {
    consult.startedAt = new Date();
    consult.clinicianId = consult.clinicianId || req.user._id;
  }
  if (req.body.status === 'completed') consult.endedAt = new Date();
  consult.updatedBy = req.user._id;
  await consult.save();

  return sendResponse(res, {
    message: 'Consultation updated',
    data: consult,
    // A poor link changes the evidential weight of the consultation, so it is
    // surfaced rather than buried in a field nobody reads.
    meta:
      consult.connectionQuality === 'poor'
        ? { warning: 'Connection was poor — consider whether the assessment was adequate.' }
        : undefined,
  });
});

export const listTeleconsultations = list(Teleconsultation);
