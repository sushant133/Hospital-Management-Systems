import { Encounter, Patient, Department, User, Bed, VitalSigns } from '../models/index.js';
import { evaluateVitals } from '../services/vitalsService.js';
import { ROLES } from '../config/env.js';
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

const POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender phone' },
  { path: 'departmentId', select: 'code name' },
  { path: 'attendingDoctorId', select: 'firstName lastName specialization' },
  { path: 'admission.wardId', select: 'code name type' },
  { path: 'admission.bedId', select: 'bedNumber' },
];

/** GET /encounters */
export const listEncounters = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-startedAt' });

  const dateRange = {};
  if (query.from) dateRange.$gte = query.from;
  if (query.to) dateRange.$lte = query.to;

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.attendingDoctorId ? { attendingDoctorId: query.attendingDoctorId } : null,
    query.type ? { type: query.type } : null,
    query.status ? { status: query.status } : null,
    Object.keys(dateRange).length ? { startedAt: dateRange } : null,
  );

  const [encounters, total] = await Promise.all([
    Encounter.find(filter)
      .populate(POPULATE)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Encounter.countDocuments(filter),
  ]);

  return sendResponse(res, { data: encounters, meta: buildMeta({ page, limit, total }) });
});

/** GET /encounters/:id */
export const getEncounter = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id).populate(POPULATE);
  if (!encounter) throw ApiError.notFound('Visit not found');
  return sendResponse(res, { data: encounter });
});

/**
 * POST /encounters — open a visit.
 * Validates every referenced parent exists and is active before writing, since
 * Mongoose refs are not enforced by the database.
 */
export const createEncounter = asyncHandler(async (req, res) => {
  const { patientId, departmentId, attendingDoctorId, vitals, ...rest } = req.body;

  const patient = await Patient.findOne({ _id: patientId, isActive: true }).lean();
  if (!patient) {
    throw ApiError.badRequest('The selected patient does not exist or is inactive', {
      details: [{ field: 'patientId', message: 'Invalid patient' }],
    });
  }

  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
  if (!department) {
    throw ApiError.badRequest('The selected department does not exist or is inactive', {
      details: [{ field: 'departmentId', message: 'Invalid department' }],
    });
  }

  if (attendingDoctorId) await assertDoctor(attendingDoctorId);

  // Guard against double-registration at the front desk.
  const alreadyOpen = await Encounter.findOne({
    patientId,
    status: { $in: ['open', 'admitted'] },
    isActive: true,
  })
    .select('encounterNumber type status')
    .lean();

  if (alreadyOpen) {
    throw ApiError.conflict(
      `This patient already has an open visit (${alreadyOpen.encounterNumber}). Close it before opening another.`,
      { code: 'PATIENT_HAS_OPEN_ENCOUNTER', details: { encounter: alreadyOpen } },
    );
  }

  const encounter = await Encounter.create({
    ...rest,
    patientId,
    departmentId,
    attendingDoctorId: attendingDoctorId || null,
    startedAt: rest.startedAt || new Date(),
    status: 'open',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  /**
   * Triage observations taken at registration are accepted here for
   * convenience, but they are stored as the first entry in the vitals series,
   * not on the encounter — see the note in models/Encounter.js. Every later
   * reading goes through POST /encounters/:id/vitals.
   */
  if (vitals) {
    const firstReading = new VitalSigns({
      ...vitals,
      patientId: encounter.patientId,
      encounterId: encounter._id,
      recordedBy: req.user._id,
      recordedAt: vitals.recordedAt ?? encounter.startedAt,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    evaluateVitals(firstReading);
    await firstReading.save();
  }

  await encounter.populate(POPULATE);
  return sendCreated(res, { message: 'Visit opened', data: encounter });
});

/** PATCH /encounters/:id — clinical updates while the visit is open. */
export const updateEncounter = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict('This visit is closed and can no longer be edited', {
      code: 'ENCOUNTER_CLOSED',
    });
  }

  const { departmentId, attendingDoctorId, ...rest } = req.body;

  if (departmentId) {
    const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
    if (!department) {
      throw ApiError.badRequest('The selected department does not exist or is inactive', {
        details: [{ field: 'departmentId', message: 'Invalid department' }],
      });
    }
    encounter.departmentId = departmentId;
  }

  if (attendingDoctorId !== undefined) {
    if (attendingDoctorId) await assertDoctor(attendingDoctorId);
    encounter.attendingDoctorId = attendingDoctorId || null;
  }

  Object.assign(encounter, rest);
  encounter.updatedBy = req.user._id;
  await encounter.save();

  await encounter.populate(POPULATE);
  return sendResponse(res, { message: 'Visit updated', data: encounter });
});

/**
 * POST /encounters/:id/close — close an OPD visit or discharge an admission.
 * Releases the bed when one is held.
 */
export const closeEncounter = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict('This visit is already closed', { code: 'ENCOUNTER_CLOSED' });
  }

  const now = req.body.endedAt || new Date();

  if (encounter.admission?.bedId) {
    await Bed.findByIdAndUpdate(encounter.admission.bedId, {
      status: 'cleaning', // released beds go through cleaning, not straight to available
      currentPatientId: null,
      currentEncounterId: null,
      updatedBy: req.user._id,
    });
    encounter.admission.dischargedAt = now;
    if (req.body.dischargeSummary) encounter.admission.dischargeSummary = req.body.dischargeSummary;
    if (req.body.dischargeType) encounter.admission.dischargeType = req.body.dischargeType;
  }

  encounter.status = 'discharged';
  encounter.endedAt = now;
  encounter.updatedBy = req.user._id;
  await encounter.save();

  await encounter.populate(POPULATE);
  return sendResponse(res, { message: 'Visit closed', data: encounter });
});

/** DELETE /encounters/:id — soft delete (cancels the visit). */
export const cancelEncounter = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findById(req.params.id);
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (encounter.admission?.bedId) {
    await Bed.findByIdAndUpdate(encounter.admission.bedId, {
      status: 'cleaning',
      currentPatientId: null,
      currentEncounterId: null,
      updatedBy: req.user._id,
    });
  }

  encounter.status = 'cancelled';
  encounter.endedAt = new Date();
  Object.assign(encounter, softDeletePatch(req.user));
  await encounter.save();

  return sendResponse(res, { message: 'Visit cancelled', data: { id: encounter._id } });
});

async function assertDoctor(userId) {
  const doctor = await User.findOne({
    _id: userId,
    isActive: true,
    role: { $in: [ROLES.DOCTOR, ROLES.ADMIN] },
  }).lean();

  if (!doctor) {
    throw ApiError.badRequest('The selected attending doctor is not a valid active doctor', {
      details: [{ field: 'attendingDoctorId', message: 'Invalid doctor' }],
    });
  }
  return doctor;
}
