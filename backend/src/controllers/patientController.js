import { Patient, Encounter } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { setAuditContext } from '../middleware/auditLogger.js';
import { can, MODULES } from '../config/permissions.js';
import {
  findPotentialDuplicates,
  hasBlockingDuplicate,
  MPI_THRESHOLDS,
} from '../services/mpiService.js';
import { mergePatients as mergePatientRecords } from '../services/mergeService.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  searchFilter,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';

/** GET /patients — paginated, searchable list. */
export const listPatients = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination(query);

  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.gender ? { gender: query.gender } : null,
    query.bloodGroup ? { bloodGroup: query.bloodGroup } : null,
    // Regex search rather than $text: supports partial matches on MRN/phone,
    // which is what reception actually types.
    searchFilter(query.search, ['firstName', 'lastName', 'mrn', 'phone', 'email']),
    req.headers['x-facility-id'] ? { facilityId: req.headers['x-facility-id'] } : null,
  );

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .select('-medicalHistory') // list view never needs the full EMR
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Patient.countDocuments(filter),
  ]);

  return sendResponse(res, { data: patients, meta: buildMeta({ page, limit, total }) });
});

/** GET /patients/:id — full record including medical history. */
export const getPatient = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id)
    .populate({ path: 'registeredBy', select: 'firstName lastName role' })
    .populate({ path: 'createdBy', select: 'firstName lastName role' })
    .populate({ path: 'updatedBy', select: 'firstName lastName role' });

  if (!patient) throw ApiError.notFound('Patient not found');
  return sendResponse(res, { data: patient });
});

/**
 * POST /patients/check-duplicates — MPI search without registering anyone.
 *
 * The front desk calls this as the form is filled in, so a duplicate surfaces
 * before the receptionist has typed a full record rather than after.
 */
export const checkDuplicates = asyncHandler(async (req, res) => {
  const { excludeId, ...candidate } = req.body;

  const matches = await findPotentialDuplicates(candidate, { excludeId });

  return sendResponse(res, {
    data: {
      matches,
      blocking: hasBlockingDuplicate(matches),
      thresholds: MPI_THRESHOLDS,
    },
  });
});

/**
 * POST /patients — register a new patient. MRN is assigned automatically.
 *
 * Runs the MPI check first. A high-confidence match (score ≥ BLOCK) returns 409
 * with the matching records instead of creating a second chart. Registering
 * anyway requires the `patients.overrideDuplicate` permission plus a written
 * reason, and the override is recorded in the audit trail.
 */
export const createPatient = asyncHandler(async (req, res) => {
  const { acknowledgeDuplicates, duplicateOverrideReason, ...patientData } = req.body;

  const matches = await findPotentialDuplicates(patientData);
  const blocking = hasBlockingDuplicate(matches);

  if (blocking && !acknowledgeDuplicates) {
    throw ApiError.conflict(
      'This person may already be registered. Review the matching records before continuing.',
      {
        code: 'POSSIBLE_DUPLICATE_PATIENT',
        details: { matches, thresholds: MPI_THRESHOLDS },
      },
    );
  }

  if (blocking && acknowledgeDuplicates) {
    if (!can(req.user.role, MODULES.PATIENTS, 'overrideDuplicate')) {
      throw ApiError.forbidden(
        'Your role cannot register a patient over a duplicate warning. Ask an administrator or the records desk.',
        { code: 'INSUFFICIENT_PERMISSION' },
      );
    }
    if (!duplicateOverrideReason || duplicateOverrideReason.trim().length < 10) {
      throw ApiError.validation('Explain why this is a different person (at least 10 characters).', {
        duplicateOverrideReason: 'A reason is required to override a duplicate warning',
      });
    }
  }

  const patient = await Patient.create({
    ...patientData,
    registeredBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  setAuditContext(req, {
    patientId: patient._id,
    resourceRef: patient.mrn,
    reason: blocking ? duplicateOverrideReason : undefined,
    changes: {
      after: patient.toObject(),
      ...(matches.length > 0
        ? {
            duplicateCheck: {
              overridden: blocking,
              matches: matches.map((m) => ({
                mrn: m.patient.mrn,
                score: m.score,
                matchedOn: m.matchedOn,
              })),
            },
          }
        : {}),
    },
  });

  return sendCreated(res, {
    message: 'Patient registered',
    // Non-blocking near-matches ride along so the UI can still show them.
    data: patient,
    meta: matches.length > 0 ? { possibleDuplicates: matches } : undefined,
  });
});

/** PATCH /patients/:id — demographics only; medical history has its own route. */
export const updatePatient = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) throw ApiError.notFound('Patient not found');

  // Snapshot before mutating so the audit entry carries a real field-level diff.
  const before = patient.toObject();

  Object.assign(patient, req.body);
  patient.updatedBy = req.user._id;
  await patient.save();

  setAuditContext(req, {
    before,
    after: patient,
    patientId: patient._id,
    resourceRef: patient.mrn,
  });

  return sendResponse(res, { message: 'Patient updated', data: patient });
});

/**
 * PATCH /patients/:id/medical-history
 * Replaces whole sections. Only the sections present in the body are touched,
 * so a client can update allergies without resending the entire EMR.
 */
export const updateMedicalHistory = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) throw ApiError.notFound('Patient not found');

  const before = { medicalHistory: patient.toObject().medicalHistory };

  for (const [section, value] of Object.entries(req.body)) {
    if (value !== undefined) patient.medicalHistory[section] = value;
  }

  patient.markModified('medicalHistory');
  patient.updatedBy = req.user._id;
  await patient.save();

  setAuditContext(req, {
    before,
    after: { medicalHistory: patient.toObject().medicalHistory },
    patientId: patient._id,
    resourceRef: patient.mrn,
  });

  return sendResponse(res, {
    message: 'Medical history updated',
    data: patient.medicalHistory,
  });
});

/**
 * GET /patients/:id/encounters — visit history, newest first.
 * Paginated because a chronic patient can accumulate hundreds of visits.
 */
export const listPatientEncounters = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id).select('_id').lean();
  if (!patient) throw ApiError.notFound('Patient not found');

  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-startedAt' });

  const filter = andFilters(
    { patientId: req.params.id },
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.type ? { type: query.type } : null,
  );

  const [encounters, total] = await Promise.all([
    Encounter.find(filter)
      .populate({ path: 'departmentId', select: 'code name' })
      .populate({ path: 'attendingDoctorId', select: 'firstName lastName specialization' })
      .populate({ path: 'admission.wardId', select: 'code name' })
      .populate({ path: 'admission.bedId', select: 'bedNumber' })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Encounter.countDocuments(filter),
  ]);

  return sendResponse(res, { data: encounters, meta: buildMeta({ page, limit, total }) });
});

/** DELETE /patients/:id — soft delete. Blocked while a visit is still open. */
export const deletePatient = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) throw ApiError.notFound('Patient not found');

  const openEncounters = await Encounter.countDocuments({
    patientId: patient._id,
    status: { $in: ['open', 'admitted'] },
    isActive: true,
  });

  if (openEncounters > 0) {
    throw ApiError.conflict(
      `Cannot deactivate a patient with ${openEncounters} open or admitted visit(s). Close them first.`,
      { code: 'PATIENT_HAS_OPEN_ENCOUNTERS' },
    );
  }

  Object.assign(patient, softDeletePatch(req.user));
  await patient.save();

  setAuditContext(req, {
    resourceId: patient._id,
    patientId: patient._id,
    resourceRef: patient.mrn,
  });

  return sendResponse(res, { message: 'Patient record deactivated', data: { id: patient._id } });
});

/** PATCH /patients/:id/restore — admin only. */
export const restorePatient = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) throw ApiError.notFound('Patient not found');

  await patient.restore(req.user);

  setAuditContext(req, { patientId: patient._id, resourceRef: patient.mrn });

  return sendResponse(res, { message: 'Patient record restored', data: patient });
});

/**
 * POST /patients/:id/merge — absorb `sourceId` into this chart.
 *
 * `:id` is the survivor. The losing MRN stays resolvable; every child document
 * is re-pointed. Irreversible from the UI.
 */
export const mergePatients = asyncHandler(async (req, res) => {
  const result = await mergePatientRecords({
    sourceId: req.body.sourceId,
    targetId: req.params.id,
    reason: req.body.reason,
    user: req.user,
  });

  setAuditContext(req, {
    patientId: req.params.id,
    resourceRef: result.target.mrn,
    reason: req.body.reason,
    changes: {
      sourceMrn: result.source.mrn,
      targetMrn: result.target.mrn,
      rePointed: result.rePointed,
    },
  });

  return sendResponse(res, {
    message: `Merged ${result.source.mrn} into ${result.target.mrn}`,
    data: result,
  });
});
