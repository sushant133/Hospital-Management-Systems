import {
  Appointment,
  AuditLog,
  BillingLineItem,
  Claim,
  ClinicalNote,
  Dispense,
  Encounter,
  Invoice,
  LabOrder,
  LabResult,
  NursingRound,
  Patient,
  PatientPolicy,
  Payment,
  PreAuthorization,
  Prescription,
  RadiologyOrder,
  RadiologyResult,
  VitalSigns,
  MedicationAdministration,
  Surgery,
  Triage,
  Notification,
  DicomStudy,
  MaternityCase,
  AncVisit,
  Immunization,
  BloodRequest,
  Consent,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Collections whose `patientId` must follow the surviving chart.
 * Order does not matter: each update is independent.
 */
export const MERGE_COLLECTIONS = [
  { model: Appointment, name: 'Appointment' },
  { model: ClinicalNote, name: 'ClinicalNote' },
  { model: Encounter, name: 'Encounter' },
  { model: VitalSigns, name: 'VitalSigns' },
  { model: NursingRound, name: 'NursingRound' },
  { model: LabOrder, name: 'LabOrder' },
  { model: LabResult, name: 'LabResult' },
  { model: RadiologyOrder, name: 'RadiologyOrder' },
  { model: RadiologyResult, name: 'RadiologyResult' },
  { model: Prescription, name: 'Prescription' },
  { model: Dispense, name: 'Dispense' },
  { model: BillingLineItem, name: 'BillingLineItem' },
  { model: Invoice, name: 'Invoice' },
  { model: Payment, name: 'Payment' },
  { model: PatientPolicy, name: 'PatientPolicy' },
  { model: PreAuthorization, name: 'PreAuthorization' },
  { model: Claim, name: 'Claim' },
  { model: AuditLog, name: 'AuditLog' },
  { model: MedicationAdministration, name: 'MedicationAdministration' },
  { model: Surgery, name: 'Surgery' },
  { model: Triage, name: 'Triage' },
  { model: Notification, name: 'Notification' },
  { model: DicomStudy, name: 'DicomStudy' },
  { model: MaternityCase, name: 'MaternityCase' },
  { model: AncVisit, name: 'AncVisit' },
  { model: Immunization, name: 'Immunization' },
  { model: BloodRequest, name: 'BloodRequest' },
  { model: Consent, name: 'Consent' },
];

function mergeArrays(keep = [], incoming = [], keyFn) {
  const seen = new Set(keep.map(keyFn));
  const extra = incoming.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...keep, ...extra];
}

function histKey(item) {
  return `${(item.substance || item.condition || item.procedure || item.name || '').toLowerCase()}`;
}

/**
 * Absorb `sourceId` into `targetId`. The losing MRN remains resolvable; every
 * clinical and financial child is re-pointed. Not reversible from the UI.
 */
export async function mergePatients({ sourceId, targetId, reason, user }) {
  if (String(sourceId) === String(targetId)) {
    throw ApiError.badRequest('Cannot merge a chart into itself', { code: 'MERGE_SAME_RECORD' });
  }

  const [source, target] = await Promise.all([
    Patient.findById(sourceId),
    Patient.findById(targetId),
  ]);

  if (!source) throw ApiError.notFound('Source patient not found');
  if (!target) throw ApiError.notFound('Target patient not found');
  if (source.status === 'merged' || source.mergedInto) {
    throw ApiError.conflict('That chart has already been merged', { code: 'ALREADY_MERGED' });
  }
  if (target.status === 'merged' || target.mergedInto) {
    throw ApiError.conflict('Cannot merge into a chart that was itself merged', {
      code: 'TARGET_ALREADY_MERGED',
    });
  }

  const counts = {};
  for (const { model, name } of MERGE_COLLECTIONS) {
    const result = await model.updateMany(
      { patientId: source._id },
      { $set: { patientId: target._id } },
    );
    counts[name] = result.modifiedCount ?? result.nModified ?? 0;
  }

  const srcHist = source.medicalHistory ?? {};
  const tgtHist = target.medicalHistory ?? {};
  target.medicalHistory = {
    allergies: mergeArrays(tgtHist.allergies, srcHist.allergies, histKey),
    chronicConditions: mergeArrays(tgtHist.chronicConditions, srcHist.chronicConditions, histKey),
    pastSurgeries: mergeArrays(tgtHist.pastSurgeries, srcHist.pastSurgeries, histKey),
    currentMedications: mergeArrays(tgtHist.currentMedications, srcHist.currentMedications, histKey),
    familyHistory: mergeArrays(tgtHist.familyHistory, srcHist.familyHistory, histKey),
    notes: [tgtHist.notes, srcHist.notes].filter(Boolean).join('\n\n'),
  };
  target.mergedFrom = [...(target.mergedFrom ?? []), source._id];
  target.updatedBy = user?._id ?? null;
  await target.save();

  source.status = 'merged';
  source.mergedInto = target._id;
  source.mergedAt = new Date();
  source.mergedBy = user?._id ?? null;
  source.mergeReason = reason;
  source.isActive = false;
  source.deletedAt = new Date();
  source.deletedBy = user?._id ?? null;
  source.updatedBy = user?._id ?? null;
  await source.save();

  return {
    source: { id: source._id, mrn: source.mrn },
    target: { id: target._id, mrn: target.mrn },
    rePointed: counts,
  };
}

export default mergePatients;
