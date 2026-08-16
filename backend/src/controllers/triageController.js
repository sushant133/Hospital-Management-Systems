import { Triage, Patient, Encounter, Department, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { notify } from '../services/notificationService.js';

const POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender phone' },
  { path: 'encounterId', select: 'encounterNumber type status' },
  { path: 'triagedBy', select: 'firstName lastName role' },
  { path: 'assignedTo', select: 'firstName lastName role specialization' },
];

async function ensureEmergencyEncounter(patient, user) {
  const existing = await Encounter.findOne({
    patientId: patient._id,
    type: 'emergency',
    status: { $in: ['open', 'admitted'] },
    isActive: true,
  }).lean();
  if (existing) return existing;

  const department = await Department.findOne({ code: 'EMER', isActive: true }).lean();
  if (!department) {
    throw ApiError.badRequest('Emergency department is not configured', { code: 'NO_EMERGENCY_DEPT' });
  }

  return Encounter.create({
    patientId: patient._id,
    type: 'emergency',
    status: 'open',
    departmentId: department._id,
    chiefComplaint: '',
    createdBy: user._id,
    updatedBy: user._id,
  });
}

export const listTriage = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || 'esi arrivedAt',
  });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.esi ? { esi: query.esi } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.waitingOnly ? { status: { $in: ['waiting', 'in-bay'] } } : null,
  );
  const [rows, total] = await Promise.all([
    Triage.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Triage.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getTriage = asyncHandler(async (req, res) => {
  const row = await Triage.findById(req.params.id).populate(POPULATE);
  if (!row) throw ApiError.notFound('Triage assessment not found');
  return sendResponse(res, { data: row });
});

export const createTriage = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ _id: req.body.patientId, isActive: true }).lean();
  if (!patient) throw ApiError.badRequest('Invalid patient', { details: [{ field: 'patientId' }] });

  let encounterId = req.body.encounterId ?? null;
  if (encounterId) {
    const encounter = await Encounter.findOne({ _id: encounterId, isActive: true }).lean();
    if (!encounter) throw ApiError.badRequest('Invalid visit', { details: [{ field: 'encounterId' }] });
    if (String(encounter.patientId) !== String(patient._id)) {
      throw ApiError.badRequest('Visit does not belong to this patient');
    }
  } else if (req.body.openEncounter !== false) {
    const encounter = await ensureEmergencyEncounter(patient, req.user);
    encounterId = encounter._id;
    if (!encounter.chiefComplaint && req.body.chiefComplaint) {
      await Encounter.updateOne(
        { _id: encounter._id },
        { $set: { chiefComplaint: req.body.chiefComplaint, updatedBy: req.user._id } },
      );
    }
  }

  if (req.body.assignedTo) {
    const assignee = await User.findById(req.body.assignedTo).select('_id').lean();
    if (!assignee) throw ApiError.badRequest('Invalid assignee', { details: [{ field: 'assignedTo' }] });
  }

  const row = await Triage.create({
    patientId: patient._id,
    encounterId,
    chiefComplaint: req.body.chiefComplaint,
    esi: req.body.esi,
    mechanism: req.body.mechanism ?? '',
    vitals: req.body.vitals ?? {},
    trauma: req.body.trauma ?? { isTrauma: false },
    notes: req.body.notes ?? '',
    assignedTo: req.body.assignedTo ?? null,
    triagedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  if (row.esi <= 2 && row.assignedTo) {
    void notify({
      userId: row.assignedTo,
      type: 'triage',
      title: `ESI ${row.esi} waiting — ${row.triageNumber}`,
      body: `${patient.firstName} ${patient.lastName}: ${row.chiefComplaint}`,
      patientId: patient._id,
      resourceType: 'Triage',
      resourceId: row._id,
    });
  }

  await row.populate(POPULATE);
  return sendCreated(res, { message: `Triage ${row.triageNumber} recorded`, data: row });
});

export const updateTriage = asyncHandler(async (req, res) => {
  const row = await Triage.findById(req.params.id);
  if (!row) throw ApiError.notFound('Triage assessment not found');
  if (['admitted', 'discharged', 'lwbs', 'transferred'].includes(row.status) && req.body.status === undefined) {
    throw ApiError.conflict('This assessment is closed', { code: 'TRIAGE_CLOSED' });
  }
  if (req.body.vitals) row.vitals = { ...(row.vitals?.toObject?.() ?? row.vitals ?? {}), ...req.body.vitals };
  if (req.body.trauma) row.trauma = { ...(row.trauma?.toObject?.() ?? row.trauma ?? {}), ...req.body.trauma };
  if (req.body.chiefComplaint !== undefined) row.chiefComplaint = req.body.chiefComplaint;
  if (req.body.esi !== undefined) row.esi = req.body.esi;
  if (req.body.mechanism !== undefined) row.mechanism = req.body.mechanism;
  if (req.body.notes !== undefined) row.notes = req.body.notes;
  if (req.body.status) {
    if (req.body.status === 'in-bay' && !row.seenAt) row.seenAt = new Date();
    row.status = req.body.status;
  }
  row.updatedBy = req.user._id;
  await row.save();
  await row.populate(POPULATE);
  return sendResponse(res, { message: 'Triage updated', data: row });
});

export const assignTriage = asyncHandler(async (req, res) => {
  const row = await Triage.findById(req.params.id);
  if (!row) throw ApiError.notFound('Triage assessment not found');
  const assignee = await User.findById(req.body.assignedTo).select('_id firstName lastName').lean();
  if (!assignee) throw ApiError.badRequest('Invalid assignee', { details: [{ field: 'assignedTo' }] });
  row.assignedTo = assignee._id;
  if (row.status === 'waiting') {
    row.status = 'in-bay';
    row.seenAt = row.seenAt ?? new Date();
  }
  row.updatedBy = req.user._id;
  await row.save();

  void notify({
    userId: assignee._id,
    type: 'triage',
    title: `Assigned ESI ${row.esi} — ${row.triageNumber}`,
    body: row.chiefComplaint,
    patientId: row.patientId,
    resourceType: 'Triage',
    resourceId: row._id,
  });

  await row.populate(POPULATE);
  return sendResponse(res, { message: `Assigned to ${assignee.firstName} ${assignee.lastName}`, data: row });
});

export const disposeTriage = asyncHandler(async (req, res) => {
  const row = await Triage.findById(req.params.id);
  if (!row) throw ApiError.notFound('Triage assessment not found');
  if (['admitted', 'discharged', 'lwbs', 'transferred'].includes(row.status)) {
    throw ApiError.conflict('This assessment is already closed', { code: 'TRIAGE_CLOSED' });
  }
  row.status = req.body.status;
  row.dispositionAt = new Date();
  if (req.body.notes) row.notes = [row.notes, req.body.notes].filter(Boolean).join('\n');
  row.updatedBy = req.user._id;
  await row.save();
  await row.populate(POPULATE);
  return sendResponse(res, { message: `Disposition: ${row.status}`, data: row });
});
