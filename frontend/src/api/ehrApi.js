import { api } from './client.js';

/**
 * The clinical record: observations, append-only notes, and the timeline that
 * merges every module's events for one patient.
 */
export const ehrApi = {
  // --- Observations ---
  encounterVitals: (encounterId) => api.get(`/encounters/${encounterId}/vitals`),
  recordVitals: (encounterId, payload) => api.post(`/encounters/${encounterId}/vitals`, payload),
  patientVitals: (patientId, params) => api.get(`/patients/${patientId}/vitals`, { params }),

  // --- Notes (no update, no delete — corrections go through amend) ---
  listNotes: (params) => api.get('/clinical-notes', { params }),
  getNote: (id) => api.get(`/clinical-notes/${id}`),
  noteHistory: (id) => api.get(`/clinical-notes/${id}/history`),
  createNote: (payload) => api.post('/clinical-notes', payload),
  amendNote: (id, payload) => api.post(`/clinical-notes/${id}/amend`, payload),

  // --- Timeline ---
  timeline: (patientId, params) => api.get(`/patients/${patientId}/timeline`, { params }),
};

export const NOTE_TYPE_OPTIONS = [
  { value: 'soap', label: 'SOAP note' },
  { value: 'progress', label: 'Progress note' },
  { value: 'nursing', label: 'Nursing note' },
  { value: 'discharge', label: 'Discharge summary' },
];

export const NOTE_TYPE_LABELS = {
  soap: 'SOAP',
  progress: 'Progress',
  nursing: 'Nursing',
  discharge: 'Discharge',
};

/** Matches the server's vitals flag vocabulary (services/vitalsService.js). */
export const VITAL_FLAG_TONES = {
  normal: 'success',
  low: 'warning',
  high: 'warning',
  'critical-low': 'danger',
  'critical-high': 'danger',
};

export const VITAL_FLAG_LABELS = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  'critical-low': 'Critically low',
  'critical-high': 'Critically high',
};

/** Display metadata for each measurement — label, unit, input step. */
export const VITAL_FIELDS = [
  { key: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1' },
  { key: 'pulseBpm', label: 'Pulse', unit: 'bpm', step: '1' },
  { key: 'respiratoryRate', label: 'Resp. rate', unit: '/min', step: '1' },
  { key: 'systolicBp', label: 'Systolic BP', unit: 'mmHg', step: '1' },
  { key: 'diastolicBp', label: 'Diastolic BP', unit: 'mmHg', step: '1' },
  { key: 'spo2', label: 'SpO₂', unit: '%', step: '1' },
  { key: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
  { key: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
  { key: 'painScore', label: 'Pain score', unit: '/10', step: '1' },
];

export const TIMELINE_TYPE_OPTIONS = [
  { value: 'encounter', label: 'Visits' },
  { value: 'note', label: 'Notes' },
  { value: 'vitals', label: 'Observations' },
  { value: 'labOrder', label: 'Lab orders' },
  { value: 'labResult', label: 'Lab results' },
  { value: 'radiologyOrder', label: 'Imaging orders' },
  { value: 'radiologyResult', label: 'Imaging reports' },
  { value: 'appointment', label: 'Appointments' },
];

export default ehrApi;
