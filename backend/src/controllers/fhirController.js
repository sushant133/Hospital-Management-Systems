import { Patient, Encounter, VitalSigns, LabResult, Prescription } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  capabilityStatement,
  toFhirPatient,
  toFhirEncounter,
  toFhirObservationFromVitals,
  toFhirObservationFromLab,
  toFhirMedicationRequest,
  buildEncounterBundle,
} from '../services/fhirService.js';

export const metadata = asyncHandler(async (_req, res) => {
  res.json(capabilityStatement());
});

export const readPatient = asyncHandler(async (req, res) => {
  const row = await Patient.findById(req.params.id).lean();
  if (!row) throw ApiError.notFound('Patient not found');
  res.json(toFhirPatient(row));
});

export const searchPatient = asyncHandler(async (req, res) => {
  const identifier = req.query.identifier;
  const filter = { isActive: true };
  if (identifier) {
    const value = String(identifier).split('|').pop();
    filter.$or = [{ mrn: value }, { abhaId: value }, { nationalId: value }];
  }
  if (req.query.name) {
    filter.$or = [
      ...(filter.$or ?? []),
      { firstName: new RegExp(req.query.name, 'i') },
      { lastName: new RegExp(req.query.name, 'i') },
    ];
  }
  const rows = await Patient.find(filter).limit(20).lean();
  res.json({
    resourceType: 'Bundle',
    type: 'searchset',
    total: rows.length,
    entry: rows.map((p) => ({ resource: toFhirPatient(p) })),
  });
});

export const searchEncounter = asyncHandler(async (req, res) => {
  const patient = req.query.patient?.replace('Patient/', '');
  if (!patient) throw ApiError.badRequest('patient is required');
  const rows = await Encounter.find({ patientId: patient, isActive: true }).sort({ startedAt: -1 }).limit(50).lean();
  res.json({
    resourceType: 'Bundle',
    type: 'searchset',
    total: rows.length,
    entry: rows.map((e) => ({ resource: toFhirEncounter(e) })),
  });
});

export const searchObservation = asyncHandler(async (req, res) => {
  const patient = req.query.patient?.replace('Patient/', '');
  if (!patient) throw ApiError.badRequest('patient is required');
  const category = req.query.category;
  const entries = [];
  if (!category || category.includes('vital')) {
    const vitals = await VitalSigns.find({ patientId: patient, isActive: true }).sort({ recordedAt: -1 }).limit(50).lean();
    for (const v of vitals) entries.push({ resource: toFhirObservationFromVitals(v) });
  }
  if (!category || category.includes('lab')) {
    const labs = await LabResult.find({ patientId: patient, isActive: true }).sort({ createdAt: -1 }).limit(50).lean();
    for (const l of labs) entries.push({ resource: toFhirObservationFromLab(l) });
  }
  res.json({ resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries });
});

export const searchMedicationRequest = asyncHandler(async (req, res) => {
  const patient = req.query.patient?.replace('Patient/', '');
  if (!patient) throw ApiError.badRequest('patient is required');
  const rows = await Prescription.find({ patientId: patient, isActive: true }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    resourceType: 'Bundle',
    type: 'searchset',
    total: rows.length,
    entry: rows.map((r) => ({ resource: toFhirMedicationRequest(r) })),
  });
});

export const encounterBundle = asyncHandler(async (req, res) => {
  const bundle = await buildEncounterBundle(req.params.id);
  if (!bundle) throw ApiError.notFound('Encounter not found');
  res.json(bundle);
});
