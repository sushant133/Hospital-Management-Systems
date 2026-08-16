import fs from 'node:fs';
import {
  LabOrder,
  LabResult,
  LabTest,
  Patient,
  Encounter,
  User,
  LAB_STATUS_TRANSITIONS,
} from '../models/index.js';
import { ROLES } from '../config/env.js';
import { can, MODULES } from '../config/permissions.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';
import { createCharges, cancelChargesForSource } from '../services/billingService.js';
import { buildResultValues } from '../services/labService.js';
import { generateLabReport, resolveUploadPath } from '../services/pdfService.js';

const ORDER_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender phone' },
  { path: 'encounterId', select: 'encounterNumber type status startedAt' },
  { path: 'orderedBy', select: 'firstName lastName role specialization' },
  { path: 'collectedBy', select: 'firstName lastName role' },
];

const RESULT_POPULATE = [
  { path: 'performedBy', select: 'firstName lastName role licenseNumber' },
  { path: 'verifiedBy', select: 'firstName lastName role licenseNumber' },
];

/** Reject any status change that isn't a legal forward transition. */
function assertTransition(from, to) {
  const allowed = LAB_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `Cannot move a lab order from "${from}" to "${to}".` +
        (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This order is final.'),
      { code: 'INVALID_STATUS_TRANSITION' },
    );
  }
}

// ------------------------------------------------------------- listing ----

/** GET /lab/orders — worklist + history. */
export const listLabOrders = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const dateRange = {};
  if (query.from) dateRange.$gte = query.from;
  if (query.to) dateRange.$lte = query.to;

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.orderedBy ? { orderedBy: query.orderedBy } : null,
    query.status ? { status: query.status } : null,
    query.priority ? { priority: query.priority } : null,
    query.pendingOnly ? { status: { $in: ['ordered', 'collected', 'in-progress'] } } : null,
    Object.keys(dateRange).length ? { createdAt: dateRange } : null,
  );

  const [orders, total] = await Promise.all([
    LabOrder.find(filter).populate(ORDER_POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    LabOrder.countDocuments(filter),
  ]);

  return sendResponse(res, { data: orders, meta: buildMeta({ page, limit, total }) });
});

/** GET /lab/orders/:id — order plus any results entered so far. */
export const getLabOrder = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id).populate(ORDER_POPULATE);
  if (!order) throw ApiError.notFound('Lab order not found');

  const results = await LabResult.find({ labOrderId: order._id, isActive: true })
    .populate(RESULT_POPULATE)
    .lean();

  // The catalogue definitions the result-entry form renders from.
  const catalogue = await LabTest.find({
    _id: { $in: order.tests.map((t) => t.labTestId) },
  })
    .select('code name specimen analytes')
    .lean();

  return sendResponse(res, { data: { ...order.toJSON(), results, catalogue } });
});

// ------------------------------------------------------------ ordering ----

/**
 * POST /lab/orders
 *
 * Raises billing lines at order time — the hospital commits the cost when the
 * test is requested, and cancellation reverses them. See
 * services/billingService.js.
 */
export const createLabOrder = asyncHandler(async (req, res) => {
  const { patientId, encounterId, labTestIds, orderedBy, ...rest } = req.body;

  const patient = await Patient.findOne({ _id: patientId, isActive: true }).lean();
  if (!patient) {
    throw ApiError.badRequest('The selected patient does not exist or is inactive', {
      details: [{ field: 'patientId', message: 'Invalid patient' }],
    });
  }

  const encounter = await Encounter.findOne({ _id: encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('The selected visit does not exist or is inactive', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }

  if (String(encounter.patientId) !== String(patientId)) {
    throw ApiError.badRequest('That visit belongs to a different patient', {
      details: [{ field: 'encounterId', message: 'Visit does not belong to this patient' }],
    });
  }

  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict('Cannot order tests against a closed visit', {
      code: 'ENCOUNTER_CLOSED',
    });
  }

  // Resolve the ordering clinician.
  const orderingDoctorId = orderedBy ?? (req.user.role === ROLES.DOCTOR ? req.user._id : null);
  if (!orderingDoctorId) {
    throw ApiError.badRequest('Specify the ordering doctor', {
      details: [{ field: 'orderedBy', message: 'Required when the requester is not a doctor' }],
    });
  }
  const doctor = await User.findOne({
    _id: orderingDoctorId,
    isActive: true,
    role: { $in: [ROLES.DOCTOR, ROLES.ADMIN] },
  }).lean();
  if (!doctor) {
    throw ApiError.badRequest('The ordering clinician must be an active doctor', {
      details: [{ field: 'orderedBy', message: 'Invalid doctor' }],
    });
  }

  // Snapshot name/specimen/price so later catalogue edits never rewrite this order.
  const uniqueIds = [...new Set(labTestIds.map(String))];
  const tests = await LabTest.find({ _id: { $in: uniqueIds }, isActive: true }).lean();

  if (tests.length !== uniqueIds.length) {
    const found = new Set(tests.map((t) => String(t._id)));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw ApiError.badRequest('One or more selected tests are unavailable', {
      details: missing.map((id) => ({ field: 'labTestIds', message: `Unknown or retired test ${id}` })),
    });
  }

  const order = await LabOrder.create({
    ...rest,
    patientId,
    encounterId,
    orderedBy: orderingDoctorId,
    tests: tests.map((test) => ({
      labTestId: test._id,
      code: test.code,
      name: test.name,
      specimen: test.specimen,
      price: test.price,
    })),
    status: 'ordered',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  // Feed the SHARED billing ledger — no lab-specific invoice.
  await createCharges({
    patientId,
    encounterId,
    sourceType: 'lab',
    sourceId: order._id,
    sourceRef: order.orderNumber,
    user: req.user,
    items: tests.map((test) => ({
      itemCode: test.code,
      description: `Lab: ${test.name}`,
      quantity: 1,
      unitPrice: test.price,
      departmentId: test.departmentId,
    })),
  });

  await order.populate(ORDER_POPULATE);
  return sendCreated(res, {
    message: `Lab order ${order.orderNumber} created and charged to the visit`,
    data: order,
  });
});

// ---------------------------------------------------- sample tracking ----

/** POST /lab/orders/:id/collect — ordered → collected. */
export const collectSample = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  assertTransition(order.status, 'collected');

  order.status = 'collected';
  order.collectedAt = req.body.collectedAt || new Date();
  order.collectedBy = req.user._id;
  if (req.body.sampleId) order.sampleId = req.body.sampleId;
  order.updatedBy = req.user._id;
  await order.save();

  await order.populate(ORDER_POPULATE);
  return sendResponse(res, { message: 'Sample marked as collected', data: order });
});

/** POST /lab/orders/:id/start — collected → in-progress. */
export const startProcessing = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  assertTransition(order.status, 'in-progress');

  order.status = 'in-progress';
  order.startedAt = new Date();
  order.updatedBy = req.user._id;
  await order.save();

  await order.populate(ORDER_POPULATE);
  return sendResponse(res, { message: 'Order moved to in-progress', data: order });
});

/** POST /lab/orders/:id/cancel — reverses the unbilled charges. */
export const cancelLabOrder = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  assertTransition(order.status, 'cancelled');

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason ?? '';
  order.updatedBy = req.user._id;
  await order.save();

  const billing = await cancelChargesForSource({
    sourceType: 'lab',
    sourceId: order._id,
    user: req.user,
    reason: `Lab order ${order.orderNumber} cancelled`,
  });

  return sendResponse(res, {
    message:
      `Lab order cancelled. ${billing.cancelled} charge(s) reversed.` +
      (billing.alreadyInvoiced
        ? ` ${billing.alreadyInvoiced} charge(s) were already invoiced and need a credit note.`
        : ''),
    data: { id: order._id, status: order.status, billing },
  });
});

// -------------------------------------------------------------- results ----

/**
 * POST /lab/orders/:id/results — enter (or re-save) one test's results.
 *
 * Completing the last outstanding test flips the order to `completed` and
 * generates the PDF report.
 */
export const submitResult = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  if (['completed', 'cancelled'].includes(order.status)) {
    throw ApiError.conflict(`Cannot enter results on a ${order.status} order`, {
      code: 'ORDER_NOT_OPEN',
    });
  }
  if (order.status === 'ordered') {
    throw ApiError.conflict('Record sample collection before entering results', {
      code: 'SAMPLE_NOT_COLLECTED',
    });
  }

  const { labTestId, entries, technicianNotes, interpretation, status } = req.body;

  const orderedTest = order.tests.find((t) => String(t.labTestId) === String(labTestId));
  if (!orderedTest) {
    throw ApiError.badRequest('That test is not part of this order', {
      details: [{ field: 'labTestId', message: 'Test not on this order' }],
    });
  }

  const labTest = await LabTest.findById(labTestId).lean();
  if (!labTest) throw ApiError.badRequest('The catalogue entry for this test no longer exists');

  // Every submitted analyte must exist on the catalogue entry.
  const validCodes = new Set(labTest.analytes.map((a) => a.code.toUpperCase()));
  const unknown = entries.filter((e) => !validCodes.has(e.analyteCode.toUpperCase()));
  if (unknown.length) {
    throw ApiError.validation(
      'Some analytes do not belong to this test',
      unknown.map((e) => ({ field: 'entries', message: `Unknown analyte "${e.analyteCode}"` })),
    );
  }

  // Reference ranges are snapshotted here — see services/labService.js.
  const values = buildResultValues(labTest, entries);
  const isVerified = status === 'verified';

  /**
   * Entering a result and signing it off are separate permissions. This route
   * is gated on `labResults.create`; submitting straight to `verified` also
   * needs `labResults.verify`, otherwise the sign-off gate could be walked
   * around by setting a field in the request body.
   */
  if (isVerified && !can(req.user.role, MODULES.LAB_RESULTS, 'verify')) {
    throw ApiError.forbidden(
      'Your role may enter preliminary results but not verify them.',
      {
        code: 'INSUFFICIENT_PERMISSION',
        details: { module: MODULES.LAB_RESULTS, action: 'verify' },
      },
    );
  }

  const existing = await LabResult.findOne({ labOrderId: order._id, labTestId });

  if (existing && existing.status === 'verified') {
    throw ApiError.conflict(
      'This result is already verified. Use the amend endpoint to correct it.',
      { code: 'RESULT_ALREADY_VERIFIED' },
    );
  }

  const payload = {
    labOrderId: order._id,
    patientId: order.patientId,
    encounterId: order.encounterId,
    labTestId,
    testCode: labTest.code,
    testName: labTest.name,
    values,
    technicianNotes: technicianNotes ?? '',
    interpretation: interpretation ?? '',
    status: isVerified ? 'verified' : 'preliminary',
    performedBy: req.user._id,
    verifiedBy: isVerified ? req.user._id : null,
    verifiedAt: isVerified ? new Date() : null,
    updatedBy: req.user._id,
  };

  let result;
  if (existing) {
    Object.assign(existing, payload);
    result = await existing.save();
  } else {
    result = await LabResult.create({ ...payload, createdBy: req.user._id });
  }

  // First result entered moves the order into processing.
  if (order.status === 'collected') {
    order.status = 'in-progress';
    order.startedAt = order.startedAt ?? new Date();
    order.updatedBy = req.user._id;
    await order.save();
  }

  const completion = await finalizeIfComplete(order, req.user);

  await result.populate(RESULT_POPULATE);

  if (result.hasCriticalValues && order.orderedBy) {
    const { notify } = await import('../services/notificationService.js');
    void notify({
      userId: order.orderedBy,
      type: 'lab-critical',
      title: `Critical lab values on ${order.orderNumber}`,
      body: `${result.testName} has one or more critical values.`,
      patientId: order.patientId,
      resourceType: 'LabOrder',
      resourceId: order._id,
    });
  }

  return sendResponse(res, {
    message: completion.completed
      ? 'Result saved. All tests are complete — report generated.'
      : `Result saved (${completion.verifiedCount}/${completion.totalTests} tests verified).`,
    data: { result, order: completion.order, reportGenerated: completion.completed },
  });
});

/**
 * POST /lab/orders/:id/results/:resultId/amend
 *
 * Corrects a verified result. The report is regenerated so the printed
 * document always matches the stored values.
 */
export const amendResult = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  const result = await LabResult.findOne({ _id: req.params.resultId, labOrderId: order._id });
  if (!result) throw ApiError.notFound('Result not found on this order');

  const labTest = await LabTest.findById(result.labTestId).lean();
  if (!labTest) throw ApiError.badRequest('The catalogue entry for this test no longer exists');

  const validCodes = new Set(labTest.analytes.map((a) => a.code.toUpperCase()));
  const unknown = req.body.entries.filter((e) => !validCodes.has(e.analyteCode.toUpperCase()));
  if (unknown.length) {
    throw ApiError.validation(
      'Some analytes do not belong to this test',
      unknown.map((e) => ({ field: 'entries', message: `Unknown analyte "${e.analyteCode}"` })),
    );
  }

  result.values = buildResultValues(labTest, req.body.entries);
  result.technicianNotes = req.body.technicianNotes ?? result.technicianNotes;
  result.interpretation = req.body.interpretation ?? result.interpretation;
  result.status = 'amended';
  result.verifiedBy = req.user._id;
  result.verifiedAt = new Date();
  result.updatedBy = req.user._id;
  await result.save();

  // Keep the PDF in step with the corrected values.
  let reportRegenerated = false;
  if (order.status === 'completed') {
    await buildReport(order, req.user);
    reportRegenerated = true;
  }

  await result.populate(RESULT_POPULATE);
  return sendResponse(res, {
    message: `Result amended. ${reportRegenerated ? 'Report regenerated.' : ''}`.trim(),
    data: { result, reportRegenerated, amendmentReason: req.body.amendmentReason },
  });
});

/** GET /lab/results — cross-order result search (patient timeline). */
export const listLabResults = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.testCode ? { testCode: query.testCode.toUpperCase() } : null,
    query.status ? { status: query.status } : null,
    query.abnormalOnly ? { hasAbnormalValues: true } : null,
  );

  const [results, total] = await Promise.all([
    LabResult.find(filter)
      .populate(RESULT_POPULATE)
      .populate({ path: 'labOrderId', select: 'orderNumber status priority collectedAt reportPath' })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    LabResult.countDocuments(filter),
  ]);

  return sendResponse(res, { data: results, meta: buildMeta({ page, limit, total }) });
});

// --------------------------------------------------------------- report ----

/** GET /lab/orders/:id/report — streams the PDF through an authenticated route. */
export const downloadReport = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id).populate({
    path: 'patientId',
    select: 'mrn firstName lastName',
  });
  if (!order) throw ApiError.notFound('Lab order not found');

  if (!order.reportPath) {
    throw ApiError.notFound('No report has been generated for this order yet', {
      code: 'REPORT_NOT_GENERATED',
    });
  }

  const absolutePath = resolveUploadPath(order.reportPath);
  if (!fs.existsSync(absolutePath)) {
    throw ApiError.notFound('The report file is missing from storage', {
      code: 'REPORT_FILE_MISSING',
    });
  }

  const fileName = `${order.orderNumber}-${order.patientId?.mrn ?? 'report'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  fs.createReadStream(absolutePath).pipe(res);
});

/** POST /lab/orders/:id/report — force regeneration. */
export const regenerateReport = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  const verified = await LabResult.countDocuments({
    labOrderId: order._id,
    isActive: true,
    status: { $in: ['verified', 'amended'] },
  });
  if (verified === 0) {
    throw ApiError.conflict('There are no verified results to report on yet', {
      code: 'NO_VERIFIED_RESULTS',
    });
  }

  const updated = await buildReport(order, req.user);

  return sendResponse(res, {
    message: 'Report regenerated',
    data: { reportPath: updated.reportPath, reportGeneratedAt: updated.reportGeneratedAt },
  });
});

/** DELETE /lab/orders/:id — soft delete (admin only). */
export const deleteLabOrder = asyncHandler(async (req, res) => {
  const order = await LabOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Lab order not found');

  await cancelChargesForSource({
    sourceType: 'lab',
    sourceId: order._id,
    user: req.user,
    reason: `Lab order ${order.orderNumber} deleted`,
  });

  Object.assign(order, softDeletePatch(req.user));
  await order.save();
  await LabResult.updateMany({ labOrderId: order._id, isActive: true }, softDeletePatch(req.user));

  return sendResponse(res, { message: 'Lab order removed', data: { id: order._id } });
});

// -------------------------------------------------------------- helpers ----

/**
 * Complete the order and generate the report once every ordered test has a
 * verified (or amended) result.
 */
async function finalizeIfComplete(order, user) {
  const results = await LabResult.find({ labOrderId: order._id, isActive: true })
    .select('labTestId status')
    .lean();

  const verifiedTestIds = new Set(
    results
      .filter((r) => ['verified', 'amended'].includes(r.status))
      .map((r) => String(r.labTestId)),
  );

  const totalTests = order.tests.length;
  const verifiedCount = order.tests.filter((t) => verifiedTestIds.has(String(t.labTestId))).length;

  if (verifiedCount < totalTests) {
    return { completed: false, verifiedCount, totalTests, order };
  }

  order.status = 'completed';
  order.completedAt = new Date();
  order.updatedBy = user._id;
  await order.save();

  const updated = await buildReport(order, user);
  return { completed: true, verifiedCount, totalTests, order: updated };
}

/**
 * Render the PDF and record its path on the order.
 *
 * Report generation must never lose a clinical result: if rendering fails the
 * error is logged and the order keeps its data, with reportPath left unset so
 * it can be retried via POST /lab/orders/:id/report.
 */
async function buildReport(order, user) {
  const [patient, encounter, results] = await Promise.all([
    Patient.findById(order.patientId).lean(),
    Encounter.findById(order.encounterId).lean(),
    LabResult.find({ labOrderId: order._id, isActive: true })
      .populate(RESULT_POPULATE)
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const orderForReport = await LabOrder.findById(order._id)
    .populate({ path: 'orderedBy', select: 'firstName lastName specialization' })
    .lean();

  try {
    const { relativePath } = await generateLabReport({
      order: orderForReport,
      patient,
      encounter,
      results,
    });

    order.reportPath = relativePath;
    order.reportGeneratedAt = new Date();
    order.updatedBy = user._id;
    await order.save();
  } catch (error) {
    console.error(`[lab] report generation failed for ${order.orderNumber}:`, error);
  }

  return order;
}
