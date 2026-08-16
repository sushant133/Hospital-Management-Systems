import {
  MedicationAdministration,
  Prescription,
  Patient,
  Encounter,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';

const POPULATE = [
  { path: 'administeredBy', select: 'firstName lastName role' },
  { path: 'prescriptionId', select: 'prescriptionNumber status' },
];

export const listAdministrations = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-administeredAt',
  });
  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.prescriptionId ? { prescriptionId: query.prescriptionId } : null,
    query.status ? { status: query.status } : null,
  );
  const [rows, total] = await Promise.all([
    MedicationAdministration.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    MedicationAdministration.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const recordAdministration = asyncHandler(async (req, res) => {
  const rx = await Prescription.findById(req.body.prescriptionId);
  if (!rx) throw ApiError.notFound('Prescription not found');
  if (rx.status === 'cancelled') {
    throw ApiError.conflict('Cannot chart against a cancelled prescription', { code: 'RX_CANCELLED' });
  }

  const item = rx.items.id(req.body.prescriptionItemId);
  if (!item) {
    throw ApiError.badRequest('That item is not on this prescription', {
      details: [{ field: 'prescriptionItemId', message: 'Unknown item' }],
    });
  }

  const patient = await Patient.findById(rx.patientId).select('medicalHistory.allergies').lean();
  const substance = (item.drugName || '').toLowerCase();
  const allergyHit = (patient?.medicalHistory?.allergies ?? []).find((a) =>
    substance.includes((a.substance || '').toLowerCase()),
  );
  if (allergyHit && req.body.status === 'given' && !req.body.overrideReason) {
    throw ApiError.conflict(
      `Allergy warning: ${allergyHit.substance} (${allergyHit.severity}). Supply overrideReason to chart anyway.`,
      { code: 'ALLERGY_WARNING', details: { substance: allergyHit.substance } },
    );
  }

  const encounter = await Encounter.findById(rx.encounterId).select('status').lean();
  if (encounter && ['discharged', 'cancelled'].includes(encounter.status) && req.body.status === 'given') {
    throw ApiError.conflict('Cannot administer on a closed visit', { code: 'ENCOUNTER_CLOSED' });
  }

  const row = await MedicationAdministration.create({
    patientId: rx.patientId,
    encounterId: rx.encounterId,
    prescriptionId: rx._id,
    prescriptionItemId: item._id,
    drugId: item.drugId,
    drugName: item.drugName,
    dose: req.body.dose || item.dosage,
    route: req.body.route || item.route,
    status: req.body.status,
    scheduledAt: req.body.scheduledAt ?? null,
    administeredAt: req.body.administeredAt ?? new Date(),
    administeredBy: req.user._id,
    reason: req.body.reason || req.body.overrideReason || '',
    notes: req.body.notes ?? '',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await row.populate(POPULATE);
  return sendCreated(res, { message: `Dose ${req.body.status}`, data: row });
});
