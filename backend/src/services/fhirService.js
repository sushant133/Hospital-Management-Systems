import {
  Patient,
  Encounter,
  VitalSigns,
  LabResult,
  Prescription,
} from '../models/index.js';

function ref(resourceType, id) {
  return { reference: `${resourceType}/${id}` };
}

export function toFhirPatient(patient) {
  return {
    resourceType: 'Patient',
    id: String(patient._id),
    identifier: [
      { system: 'urn:hms:mrn', value: patient.mrn },
      ...(patient.abhaId ? [{ system: 'https://abdm.gov.in/abha', value: patient.abhaId }] : []),
      ...(patient.nationalId ? [{ system: 'urn:hms:national-id', value: patient.nationalId }] : []),
    ],
    active: patient.isActive !== false && patient.status === 'active',
    name: [{ family: patient.lastName, given: [patient.firstName] }],
    gender: patient.gender,
    birthDate: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().slice(0, 10) : undefined,
    telecom: [
      patient.phone ? { system: 'phone', value: patient.phone } : null,
      patient.email ? { system: 'email', value: patient.email } : null,
    ].filter(Boolean),
  };
}

export function toFhirEncounter(encounter) {
  const statusMap = {
    open: 'in-progress',
    admitted: 'in-progress',
    discharged: 'finished',
    cancelled: 'cancelled',
  };
  return {
    resourceType: 'Encounter',
    id: String(encounter._id),
    identifier: [{ system: 'urn:hms:encounter', value: encounter.encounterNumber }],
    status: statusMap[encounter.status] ?? 'unknown',
    class: { code: encounter.type, display: encounter.type },
    subject: ref('Patient', encounter.patientId?._id ?? encounter.patientId),
    period: {
      start: encounter.startedAt,
      end: encounter.endedAt ?? undefined,
    },
  };
}

export function toFhirObservationFromVitals(row) {
  return {
    resourceType: 'Observation',
    id: String(row._id),
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
    subject: ref('Patient', row.patientId),
    encounter: row.encounterId ? ref('Encounter', row.encounterId) : undefined,
    effectiveDateTime: row.recordedAt ?? row.createdAt,
    component: [
      row.temperatureC != null ? { code: { text: 'Temperature' }, valueQuantity: { value: row.temperatureC, unit: 'Cel' } } : null,
      row.pulseBpm != null ? { code: { text: 'Heart rate' }, valueQuantity: { value: row.pulseBpm, unit: '/min' } } : null,
      row.systolicBp != null ? { code: { text: 'Systolic BP' }, valueQuantity: { value: row.systolicBp, unit: 'mmHg' } } : null,
      row.spo2 != null ? { code: { text: 'SpO2' }, valueQuantity: { value: row.spo2, unit: '%' } } : null,
    ].filter(Boolean),
  };
}

export function toFhirObservationFromLab(result) {
  return {
    resourceType: 'Observation',
    id: String(result._id),
    status: result.status === 'verified' || result.status === 'amended' ? 'final' : 'preliminary',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: result.testName, coding: result.testCode ? [{ code: result.testCode }] : [] },
    subject: ref('Patient', result.patientId),
    encounter: result.encounterId ? ref('Encounter', result.encounterId) : undefined,
    effectiveDateTime: result.verifiedAt ?? result.createdAt,
    component: (result.values ?? []).map((v) => ({
      code: { text: v.analyteName, coding: v.analyteCode ? [{ code: v.analyteCode }] : [] },
      valueString: v.value,
      interpretation: v.flag && v.flag !== 'normal' ? [{ text: v.flag }] : undefined,
    })),
  };
}

export function toFhirMedicationRequest(rx) {
  return {
    resourceType: 'MedicationRequest',
    id: String(rx._id),
    identifier: [{ system: 'urn:hms:rx', value: rx.prescriptionNumber }],
    status: rx.status === 'cancelled' ? 'cancelled' : rx.status === 'pending' ? 'active' : rx.status,
    intent: 'order',
    subject: ref('Patient', rx.patientId?._id ?? rx.patientId),
    encounter: rx.encounterId ? ref('Encounter', rx.encounterId._id ?? rx.encounterId) : undefined,
    authoredOn: rx.createdAt,
    medicationCodeableConcept: {
      text: (rx.items ?? []).map((i) => `${i.drugName} ${i.strength ?? ''}`).join('; '),
    },
    dosageInstruction: (rx.items ?? []).map((i) => ({
      text: [i.dosage, i.frequency, i.route].filter(Boolean).join(', '),
    })),
  };
}

export function capabilityStatement() {
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['application/fhir+json', 'application/json'],
    rest: [
      {
        mode: 'server',
        resource: [
          { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }] },
          { type: 'Encounter', interaction: [{ code: 'read' }, { code: 'search-type' }] },
          { type: 'Observation', interaction: [{ code: 'search-type' }] },
          { type: 'MedicationRequest', interaction: [{ code: 'read' }, { code: 'search-type' }] },
        ],
      },
    ],
  };
}

export async function buildEncounterBundle(encounterId) {
  const encounter = await Encounter.findById(encounterId).lean();
  if (!encounter) return null;
  const [patient, vitals, labs, rxs] = await Promise.all([
    Patient.findById(encounter.patientId).lean(),
    VitalSigns.find({ encounterId, isActive: true }).lean(),
    LabResult.find({ encounterId, isActive: true }).lean(),
    Prescription.find({ encounterId, isActive: true }).lean(),
  ]);
  const entries = [];
  if (patient) entries.push({ resource: toFhirPatient(patient) });
  entries.push({ resource: toFhirEncounter(encounter) });
  for (const v of vitals) entries.push({ resource: toFhirObservationFromVitals(v) });
  for (const l of labs) entries.push({ resource: toFhirObservationFromLab(l) });
  for (const r of rxs) entries.push({ resource: toFhirMedicationRequest(r) });
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries,
  };
}

export default {
  toFhirPatient,
  toFhirEncounter,
  toFhirMedicationRequest,
  capabilityStatement,
  buildEncounterBundle,
};
