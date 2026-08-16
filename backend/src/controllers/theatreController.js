import { Surgery, Patient, Encounter, SURGERY_TRANSITIONS } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { createCharges } from '../services/billingService.js';

const POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender' },
  { path: 'encounterId', select: 'encounterNumber type status' },
  { path: 'surgeonId', select: 'firstName lastName specialization' },
  { path: 'anaesthetistId', select: 'firstName lastName' },
];

function assertTransition(from, to) {
  const allowed = SURGERY_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot move a case from "${from}" to "${to}".`, {
      code: 'INVALID_STATUS_TRANSITION',
    });
  }
}

export const listSurgeries = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || 'scheduledStart',
  });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.theatre ? { theatre: query.theatre } : null,
    query.surgeonId ? { surgeonId: query.surgeonId } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.from || query.to
      ? {
          scheduledStart: {
            ...(query.from ? { $gte: query.from } : {}),
            ...(query.to ? { $lte: query.to } : {}),
          },
        }
      : null,
  );
  const [rows, total] = await Promise.all([
    Surgery.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    Surgery.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getSurgery = asyncHandler(async (req, res) => {
  const row = await Surgery.findById(req.params.id).populate(POPULATE);
  if (!row) throw ApiError.notFound('Surgery not found');
  return sendResponse(res, { data: row });
});

export const createSurgery = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ _id: req.body.patientId, isActive: true }).lean();
  if (!patient) throw ApiError.badRequest('Invalid patient', { details: [{ field: 'patientId' }] });
  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) throw ApiError.badRequest('Invalid visit', { details: [{ field: 'encounterId' }] });
  if (String(encounter.patientId) !== String(patient._id)) {
    throw ApiError.badRequest('Visit does not belong to this patient');
  }

  const clash = await Surgery.findOne({
    theatre: req.body.theatre,
    isActive: true,
    status: { $in: ['scheduled', 'in-theatre'] },
    scheduledStart: { $lt: req.body.scheduledEnd },
    scheduledEnd: { $gt: req.body.scheduledStart },
  }).lean();
  if (clash) {
    throw ApiError.conflict(`Theatre ${req.body.theatre} is already booked (${clash.surgeryNumber}).`, {
      code: 'THEATRE_BUSY',
    });
  }

  const surgery = await Surgery.create({
    ...req.body,
    status: 'scheduled',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  if (surgery.price > 0) {
    await createCharges({
      patientId: surgery.patientId,
      encounterId: surgery.encounterId,
      sourceType: 'procedure',
      sourceId: surgery._id,
      sourceRef: surgery.surgeryNumber,
      user: req.user,
      items: [
        {
          itemCode: surgery.surgeryNumber,
          description: `OT: ${surgery.procedure}`,
          quantity: 1,
          unitPrice: surgery.price,
        },
      ],
    });
  }

  await surgery.populate(POPULATE);
  return sendCreated(res, { message: `Case ${surgery.surgeryNumber} booked`, data: surgery });
});

export const updateSurgery = asyncHandler(async (req, res) => {
  const surgery = await Surgery.findById(req.params.id);
  if (!surgery) throw ApiError.notFound('Surgery not found');
  if (['completed', 'cancelled'].includes(surgery.status) && req.body.whoChecklist === undefined) {
    throw ApiError.conflict('This case is closed', { code: 'CASE_CLOSED' });
  }
  Object.assign(surgery, req.body);
  surgery.updatedBy = req.user._id;
  await surgery.save();
  await surgery.populate(POPULATE);
  return sendResponse(res, { message: 'Case updated', data: surgery });
});

export const startSurgery = asyncHandler(async (req, res) => {
  const surgery = await Surgery.findById(req.params.id);
  if (!surgery) throw ApiError.notFound('Surgery not found');
  assertTransition(surgery.status, 'in-theatre');
  surgery.status = 'in-theatre';
  surgery.startedAt = new Date();
  surgery.updatedBy = req.user._id;
  await surgery.save();
  await surgery.populate(POPULATE);
  return sendResponse(res, { message: 'Patient in theatre', data: surgery });
});

export const completeSurgery = asyncHandler(async (req, res) => {
  const surgery = await Surgery.findById(req.params.id);
  if (!surgery) throw ApiError.notFound('Surgery not found');
  const next = surgery.status === 'in-theatre' ? 'recovery' : 'completed';
  if (surgery.status === 'recovery') {
    assertTransition('recovery', 'completed');
    surgery.status = 'completed';
    surgery.completedAt = new Date();
  } else {
    assertTransition(surgery.status, 'recovery');
    surgery.status = 'recovery';
  }
  if (req.body.findings) surgery.findings = req.body.findings;
  surgery.updatedBy = req.user._id;
  await surgery.save();
  await surgery.populate(POPULATE);
  return sendResponse(res, { message: `Case ${next}`, data: surgery });
});

export const cancelSurgery = asyncHandler(async (req, res) => {
  const surgery = await Surgery.findById(req.params.id);
  if (!surgery) throw ApiError.notFound('Surgery not found');
  assertTransition(surgery.status, 'cancelled');
  surgery.status = 'cancelled';
  surgery.cancellationReason = req.body.reason ?? '';
  surgery.updatedBy = req.user._id;
  await surgery.save();
  return sendResponse(res, { message: 'Case cancelled', data: { id: surgery._id, status: surgery.status } });
});
