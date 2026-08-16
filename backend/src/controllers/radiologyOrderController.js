import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  RadiologyOrder,
  RadiologyResult,
  RadiologyExam,
  Patient,
  Encounter,
  User,
  RADIOLOGY_STATUS_TRANSITIONS,
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
import { generateRadiologyReport, resolveUploadPath, uploadsRoot } from '../services/pdfService.js';

const ORDER_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender phone' },
  { path: 'encounterId', select: 'encounterNumber type status startedAt' },
  { path: 'orderedBy', select: 'firstName lastName role specialization' },
  { path: 'scheduledBy', select: 'firstName lastName role' },
  { path: 'performedBy', select: 'firstName lastName role' },
];

const RESULT_POPULATE = [
  { path: 'reportedBy', select: 'firstName lastName role licenseNumber' },
  { path: 'verifiedBy', select: 'firstName lastName role licenseNumber' },
  { path: 'attachments.uploadedBy', select: 'firstName lastName role' },
];

function assertTransition(from, to) {
  const allowed = RADIOLOGY_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `Cannot move a radiology order from "${from}" to "${to}".` +
        (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This order is final.'),
      { code: 'INVALID_STATUS_TRANSITION' },
    );
  }
}

// ------------------------------------------------------------- listing ----

/** GET /radiology/orders — worklist + history. */
export const listRadiologyOrders = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-createdAt',
  });

  const dateRange = {};
  if (query.from) dateRange.$gte = query.from;
  if (query.to) dateRange.$lte = query.to;

  const scheduledRange = {};
  if (query.scheduledFrom) scheduledRange.$gte = query.scheduledFrom;
  if (query.scheduledTo) scheduledRange.$lte = query.scheduledTo;

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.orderedBy ? { orderedBy: query.orderedBy } : null,
    query.examId ? { examId: query.examId } : null,
    query.status ? { status: query.status } : null,
    query.priority ? { priority: query.priority } : null,
    query.modality ? { modality: query.modality } : null,
    query.pendingOnly ? { status: { $in: ['ordered', 'scheduled', 'in-progress'] } } : null,
    Object.keys(dateRange).length ? { createdAt: dateRange } : null,
    Object.keys(scheduledRange).length ? { scheduledFor: scheduledRange } : null,
  );

  const [orders, total] = await Promise.all([
    RadiologyOrder.find(filter).populate(ORDER_POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    RadiologyOrder.countDocuments(filter),
  ]);

  return sendResponse(res, { data: orders, meta: buildMeta({ page, limit, total }) });
});

/** GET /radiology/orders/:id — order plus its report if one exists. */
export const getRadiologyOrder = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id).populate(ORDER_POPULATE);
  if (!order) throw ApiError.notFound('Radiology order not found');

  const result = await RadiologyResult.findOne({
    radiologyOrderId: order._id,
    isActive: true,
  })
    .populate(RESULT_POPULATE)
    .lean();

  return sendResponse(res, { data: { ...order.toJSON(), result } });
});

// ------------------------------------------------------------ ordering ----

/**
 * POST /radiology/orders
 *
 * One exam per order. Raises a billing line at request time; cancellation
 * reverses unbilled charges.
 */
export const createRadiologyOrder = asyncHandler(async (req, res) => {
  const { patientId, encounterId, examId, orderedBy, ...rest } = req.body;

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
    throw ApiError.conflict('Cannot order imaging against a closed visit', {
      code: 'ENCOUNTER_CLOSED',
    });
  }

  const orderingDoctorId =
    orderedBy ??
    ([ROLES.DOCTOR, ROLES.ADMIN].includes(req.user.role) ? req.user._id : null);
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

  const exam = await RadiologyExam.findOne({ _id: examId, isActive: true }).lean();
  if (!exam) {
    throw ApiError.badRequest('The selected exam is unavailable', {
      details: [{ field: 'examId', message: 'Unknown or retired exam' }],
    });
  }

  const order = await RadiologyOrder.create({
    ...rest,
    patientId,
    encounterId,
    orderedBy: orderingDoctorId,
    examId: exam._id,
    code: exam.code,
    name: exam.name,
    modality: exam.modality,
    bodyPart: exam.bodyPart,
    price: exam.price,
    contrastRequired: exam.contrastRequired,
    status: 'ordered',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await createCharges({
    patientId,
    encounterId,
    sourceType: 'radiology',
    sourceId: order._id,
    sourceRef: order.orderNumber,
    user: req.user,
    items: [
      {
        itemCode: exam.code,
        description: `Radiology: ${exam.name}`,
        quantity: 1,
        unitPrice: exam.price,
        departmentId: exam.departmentId,
      },
    ],
  });

  await order.populate(ORDER_POPULATE);
  return sendCreated(res, {
    message: `Radiology order ${order.orderNumber} created and charged to the visit`,
    data: order,
  });
});

// ---------------------------------------------------------- lifecycle ----

/** POST /radiology/orders/:id/schedule — ordered → scheduled. */
export const scheduleOrder = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  assertTransition(order.status, 'scheduled');

  order.status = 'scheduled';
  order.scheduledFor = req.body.scheduledFor;
  order.scheduledBy = req.user._id;
  order.updatedBy = req.user._id;
  await order.save();

  await order.populate(ORDER_POPULATE);
  return sendResponse(res, { message: 'Study scheduled', data: order });
});

/** POST /radiology/orders/:id/start — ordered|scheduled → in-progress. */
export const startStudy = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  assertTransition(order.status, 'in-progress');

  order.status = 'in-progress';
  order.startedAt = new Date();
  order.performedBy = req.user._id;
  if (req.body.acquisitionNotes) order.acquisitionNotes = req.body.acquisitionNotes;
  order.updatedBy = req.user._id;
  await order.save();

  await order.populate(ORDER_POPULATE);
  return sendResponse(res, { message: 'Study marked in progress', data: order });
});

/** POST /radiology/orders/:id/cancel — reverses unbilled charges. */
export const cancelRadiologyOrder = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  assertTransition(order.status, 'cancelled');

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason ?? '';
  order.updatedBy = req.user._id;
  await order.save();

  const billing = await cancelChargesForSource({
    sourceType: 'radiology',
    sourceId: order._id,
    user: req.user,
    reason: `Radiology order ${order.orderNumber} cancelled`,
  });

  return sendResponse(res, {
    message:
      `Radiology order cancelled. ${billing.cancelled} charge(s) reversed.` +
      (billing.alreadyInvoiced
        ? ` ${billing.alreadyInvoiced} charge(s) were already invoiced and need a credit note.`
        : ''),
    data: { id: order._id, status: order.status, billing },
  });
});

// -------------------------------------------------------------- results ----

/**
 * POST /radiology/orders/:id/result — enter or re-save the report.
 *
 * Verifying completes the order and generates the PDF.
 */
export const submitResult = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  if (['completed', 'cancelled'].includes(order.status)) {
    throw ApiError.conflict(`Cannot enter a report on a ${order.status} order`, {
      code: 'ORDER_NOT_OPEN',
    });
  }
  if (order.status === 'ordered') {
    throw ApiError.conflict('Start (or schedule then start) the study before reporting', {
      code: 'STUDY_NOT_STARTED',
    });
  }

  const isVerified = req.body.status === 'verified';
  if (isVerified && !can(req.user.role, MODULES.RADIOLOGY_RESULTS, 'verify')) {
    throw ApiError.forbidden(
      'Your role may enter a preliminary report but not verify it.',
      {
        code: 'INSUFFICIENT_PERMISSION',
        details: { module: MODULES.RADIOLOGY_RESULTS, action: 'verify' },
      },
    );
  }

  const existing = await RadiologyResult.findOne({ radiologyOrderId: order._id });

  if (existing && existing.status === 'verified') {
    throw ApiError.conflict(
      'This report is already verified. Use the amend endpoint to correct it.',
      { code: 'RESULT_ALREADY_VERIFIED' },
    );
  }

  const payload = {
    radiologyOrderId: order._id,
    patientId: order.patientId,
    encounterId: order.encounterId,
    technique: req.body.technique ?? '',
    findings: req.body.findings,
    impression: req.body.impression,
    recommendation: req.body.recommendation ?? '',
    isCritical: Boolean(req.body.isCritical),
    criticalNote: req.body.criticalNote ?? '',
    status: isVerified ? 'verified' : 'preliminary',
    reportedBy: req.user._id,
    verifiedBy: isVerified ? req.user._id : null,
    verifiedAt: isVerified ? new Date() : null,
    updatedBy: req.user._id,
  };

  let result;
  if (existing) {
    Object.assign(existing, payload);
    result = await existing.save();
  } else {
    result = await RadiologyResult.create({ ...payload, createdBy: req.user._id });
  }

  if (result.isCritical && order.orderedBy) {
    const { notify } = await import('../services/notificationService.js');
    void notify({
      userId: order.orderedBy,
      type: 'radiology-critical',
      title: `Critical imaging finding on ${order.orderNumber}`,
      body: result.criticalNote || result.impression,
      patientId: order.patientId,
      resourceType: 'RadiologyOrder',
      resourceId: order._id,
    });
  }

  if (order.status === 'scheduled') {
    order.status = 'in-progress';
    order.startedAt = order.startedAt ?? new Date();
    order.updatedBy = req.user._id;
    await order.save();
  }

  const completion = isVerified ? await finalizeOrder(order, req.user) : { completed: false, order };

  await result.populate(RESULT_POPULATE);
  return sendResponse(res, {
    message: completion.completed
      ? 'Report verified. Order completed and PDF generated.'
      : 'Preliminary report saved.',
    data: { result, order: completion.order, reportGenerated: completion.completed },
  });
});

/** POST /radiology/orders/:id/result/amend */
export const amendResult = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  const result = await RadiologyResult.findOne({
    radiologyOrderId: order._id,
    isActive: true,
  });
  if (!result) throw ApiError.notFound('No report on this order to amend');

  result.technique = req.body.technique ?? result.technique;
  result.findings = req.body.findings;
  result.impression = req.body.impression;
  result.recommendation = req.body.recommendation ?? result.recommendation;
  if (req.body.isCritical !== undefined) result.isCritical = req.body.isCritical;
  if (req.body.criticalNote !== undefined) result.criticalNote = req.body.criticalNote;
  result.status = 'amended';
  result.amendmentReason = req.body.amendmentReason;
  result.verifiedBy = req.user._id;
  result.verifiedAt = new Date();
  result.updatedBy = req.user._id;
  await result.save();

  let reportRegenerated = false;
  if (order.status === 'completed') {
    await buildReport(order, req.user);
    reportRegenerated = true;
  }

  await result.populate(RESULT_POPULATE);
  return sendResponse(res, {
    message: `Report amended.${reportRegenerated ? ' PDF regenerated.' : ''}`,
    data: { result, reportRegenerated, amendmentReason: req.body.amendmentReason },
  });
});

/** GET /radiology/results — cross-order search (patient timeline). */
export const listRadiologyResults = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-createdAt',
  });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.radiologyOrderId ? { radiologyOrderId: query.radiologyOrderId } : null,
    query.status ? { status: query.status } : null,
    query.criticalOnly ? { isCritical: true } : null,
  );

  const [results, total] = await Promise.all([
    RadiologyResult.find(filter)
      .populate(RESULT_POPULATE)
      .populate({
        path: 'radiologyOrderId',
        select: 'orderNumber status priority modality name code reportPath scheduledFor',
      })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    RadiologyResult.countDocuments(filter),
  ]);

  return sendResponse(res, { data: results, meta: buildMeta({ page, limit, total }) });
});

// ---------------------------------------------------------- attachments ----

/** POST /radiology/orders/:id/attachments — multipart image/PDF upload. */
export const attachImages = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  if (order.status === 'cancelled') {
    throw ApiError.conflict('Cannot attach images to a cancelled order', {
      code: 'ORDER_CANCELLED',
    });
  }

  const files = req.files ?? [];
  if (!files.length) {
    throw ApiError.badRequest('Attach at least one file', { code: 'NO_FILES' });
  }

  const result = await RadiologyResult.findOne({ radiologyOrderId: order._id, isActive: true });
  if (!result) {
    throw ApiError.conflict('Write the report before attaching images', {
      code: 'REPORT_NOT_STARTED',
    });
  }

  const dir = path.join(uploadsRoot(), 'radiology-reports', String(order.patientId), 'attachments');
  await fs.promises.mkdir(dir, { recursive: true });

  const added = [];
  for (const file of files) {
    const ext = extensionFor(file.mimetype, file.originalname);
    const storedName = `${order.orderNumber}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const absolutePath = path.join(dir, storedName);
    await fs.promises.writeFile(absolutePath, file.buffer);

    const relativePath = path.posix.join(
      'radiology-reports',
      String(order.patientId),
      'attachments',
      storedName,
    );

    result.attachments.push({
      path: relativePath,
      filename: file.originalname || storedName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    });
    added.push(relativePath);
  }

  result.updatedBy = req.user._id;
  await result.save();
  await result.populate(RESULT_POPULATE);

  return sendResponse(res, {
    message: `${added.length} file(s) attached`,
    data: { result, added },
  });
});

/** GET /radiology/orders/:id/attachments/:attachmentId */
export const downloadAttachment = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  const result = await RadiologyResult.findOne({
    radiologyOrderId: order._id,
    isActive: true,
  }).lean();
  if (!result) throw ApiError.notFound('No report on this order');

  const attachment = (result.attachments ?? []).find(
    (item) => String(item._id) === String(req.params.attachmentId),
  );
  if (!attachment) throw ApiError.notFound('Attachment not found');

  const absolutePath = resolveUploadPath(attachment.path);
  if (!fs.existsSync(absolutePath)) {
    throw ApiError.notFound('The file is missing from storage', { code: 'ATTACHMENT_FILE_MISSING' });
  }

  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${sanitizeFilename(attachment.filename)}"`,
  );
  fs.createReadStream(absolutePath).pipe(res);
});

/** DELETE /radiology/orders/:id/attachments/:attachmentId */
export const removeAttachment = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  const result = await RadiologyResult.findOne({
    radiologyOrderId: order._id,
    isActive: true,
  });
  if (!result) throw ApiError.notFound('No report on this order');

  const attachment = result.attachments.id(req.params.attachmentId);
  if (!attachment) throw ApiError.notFound('Attachment not found');

  try {
    const absolutePath = resolveUploadPath(attachment.path);
    if (fs.existsSync(absolutePath)) await fs.promises.unlink(absolutePath);
  } catch (error) {
    console.error(`[radiology] failed to unlink attachment ${attachment.path}:`, error.message);
  }

  attachment.deleteOne();
  result.updatedBy = req.user._id;
  await result.save();

  return sendResponse(res, {
    message: 'Attachment removed',
    data: { id: req.params.attachmentId },
  });
});

// --------------------------------------------------------------- report ----

/** GET /radiology/orders/:id/report */
export const downloadReport = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id).populate({
    path: 'patientId',
    select: 'mrn firstName lastName',
  });
  if (!order) throw ApiError.notFound('Radiology order not found');

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

/** POST /radiology/orders/:id/report — force regeneration. */
export const regenerateReport = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  const result = await RadiologyResult.findOne({
    radiologyOrderId: order._id,
    isActive: true,
    status: { $in: ['verified', 'amended'] },
  });
  if (!result) {
    throw ApiError.conflict('There is no verified report to render yet', {
      code: 'NO_VERIFIED_RESULTS',
    });
  }

  const updated = await buildReport(order, req.user);

  return sendResponse(res, {
    message: 'Report regenerated',
    data: { reportPath: updated.reportPath, reportGeneratedAt: updated.reportGeneratedAt },
  });
});

/** DELETE /radiology/orders/:id — soft delete (admin only). */
export const deleteRadiologyOrder = asyncHandler(async (req, res) => {
  const order = await RadiologyOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Radiology order not found');

  await cancelChargesForSource({
    sourceType: 'radiology',
    sourceId: order._id,
    user: req.user,
    reason: `Radiology order ${order.orderNumber} deleted`,
  });

  Object.assign(order, softDeletePatch(req.user));
  await order.save();
  await RadiologyResult.updateMany(
    { radiologyOrderId: order._id, isActive: true },
    softDeletePatch(req.user),
  );

  return sendResponse(res, { message: 'Radiology order removed', data: { id: order._id } });
});

// -------------------------------------------------------------- helpers ----

async function finalizeOrder(order, user) {
  order.status = 'completed';
  order.completedAt = new Date();
  order.updatedBy = user._id;
  await order.save();

  const updated = await buildReport(order, user);
  return { completed: true, order: updated };
}

async function buildReport(order, user) {
  const [patient, encounter, result] = await Promise.all([
    Patient.findById(order.patientId).lean(),
    Encounter.findById(order.encounterId).lean(),
    RadiologyResult.findOne({ radiologyOrderId: order._id, isActive: true })
      .populate(RESULT_POPULATE)
      .lean(),
  ]);

  const orderForReport = await RadiologyOrder.findById(order._id)
    .populate({ path: 'orderedBy', select: 'firstName lastName specialization' })
    .lean();

  try {
    const { relativePath } = await generateRadiologyReport({
      order: orderForReport,
      patient,
      encounter,
      result,
    });

    order.reportPath = relativePath;
    order.reportGeneratedAt = new Date();
    order.updatedBy = user._id;
    await order.save();
  } catch (error) {
    console.error(`[radiology] report generation failed for ${order.orderNumber}:`, error);
  }

  return order;
}

function extensionFor(mimeType, originalName = '') {
  const fromName = path.extname(originalName);
  if (fromName && fromName.length <= 8) return fromName.toLowerCase();
  return (
    {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/tiff': '.tif',
      'application/pdf': '.pdf',
    }[mimeType] ?? ''
  );
}

function sanitizeFilename(name = 'file') {
  return String(name).replace(/["\r\n]/g, '_');
}
