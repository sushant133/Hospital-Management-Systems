import { VitalSigns, Encounter, Patient } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { evaluateVitals, referenceRanges, FLAG_LABELS } from '../services/vitalsService.js';
import { buildPatientTimeline } from '../services/timelineService.js';

const POPULATE = [{ path: 'recordedBy', select: 'firstName lastName role' }];

/**
 * The clinical record: observations and the unified timeline.
 *
 * Notes live in clinicalNoteController.js — they are append-only and carry
 * enough rules of their own to warrant a separate file.
 */

// -------------------------------------------------------------- vitals ----

/**
 * POST /encounters/:id/vitals — record one set of observations.
 *
 * Gated on `encounters.recordVitals`, which is narrower than `encounters.edit`:
 * a nurse may add observations to a visit without being able to change its
 * department, doctor or diagnoses.
 */
export const recordVitals = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findOne({ _id: req.params.id, isActive: true });
  if (!encounter) throw ApiError.notFound('Visit not found');

  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict(
      `This visit is ${encounter.status} — observations can no longer be added to it.`,
      { code: 'ENCOUNTER_CLOSED' },
    );
  }

  const vitals = new VitalSigns({
    ...req.body,
    patientId: encounter.patientId,
    encounterId: encounter._id,
    recordedBy: req.user._id,
    recordedAt: req.body.recordedAt ?? new Date(),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  // Flags and BMI are derived, never accepted from the client.
  evaluateVitals(vitals);
  await vitals.save();

  await vitals.populate(POPULATE);
  return sendCreated(res, {
    message: vitals.hasCritical
      ? 'Observations recorded — one or more readings are outside critical thresholds.'
      : 'Observations recorded',
    data: vitals,
  });
});

/** GET /encounters/:id/vitals — this visit's series, oldest first. */
export const listEncounterVitals = asyncHandler(async (req, res) => {
  const encounter = await Encounter.exists({ _id: req.params.id });
  if (!encounter) throw ApiError.notFound('Visit not found');

  const series = await VitalSigns.find({ encounterId: req.params.id, isActive: true })
    .populate(POPULATE)
    .sort({ recordedAt: 1 })
    .lean();

  return sendResponse(res, {
    data: series,
    meta: {
      count: series.length,
      referenceRanges: referenceRanges(),
      flagLabels: FLAG_LABELS,
    },
  });
});

/**
 * GET /patients/:id/vitals — the series across every visit.
 * This is the "structured vitals timeline": one patient, one trend.
 */
export const listPatientVitals = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-recordedAt' });

  const patient = await Patient.exists({ _id: req.params.id });
  if (!patient) throw ApiError.notFound('Patient not found');

  const dateRange = {};
  if (query.from) dateRange.$gte = query.from;
  if (query.to) dateRange.$lte = query.to;

  const filter = andFilters(
    activeScope(query, req.user),
    { patientId: req.params.id },
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.abnormalOnly ? { hasAbnormal: true } : null,
    Object.keys(dateRange).length ? { recordedAt: dateRange } : null,
  );

  const [series, total] = await Promise.all([
    VitalSigns.find(filter)
      .populate([...POPULATE, { path: 'encounterId', select: 'encounterNumber type startedAt' }])
      .sort({ recordedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    VitalSigns.countDocuments(filter),
  ]);

  return sendResponse(res, {
    data: series,
    meta: {
      ...buildMeta({ page, limit, total }),
      referenceRanges: referenceRanges(),
      flagLabels: FLAG_LABELS,
    },
  });
});

// ------------------------------------------------------------ timeline ----

/**
 * GET /patients/:id/timeline — everything, from every module, in order.
 *
 * The service filters each source by the caller's own grants, so this can never
 * surface something the module's own routes would refuse.
 */
export const getPatientTimeline = asyncHandler(async (req, res) => {
  const query = getQuery(req);

  const patient = await Patient.findById(req.params.id)
    .select('mrn firstName lastName dateOfBirth gender medicalHistory')
    .lean();
  if (!patient) throw ApiError.notFound('Patient not found');

  const events = await buildPatientTimeline({
    patientId: req.params.id,
    user: req.user,
    from: query.from,
    to: query.to,
    limit: query.limit,
    types: query.types,
  });

  const byType = events.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});

  return sendResponse(res, {
    data: events,
    meta: {
      total: events.length,
      byType,
      // Allergies travel with the timeline so the chart can show the banner
      // without a second round trip.
      allergies: patient.medicalHistory?.allergies ?? [],
      patient: {
        _id: patient._id,
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        gender: patient.gender,
      },
    },
  });
});
