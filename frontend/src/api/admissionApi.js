import { api } from './client.js';

/**
 * Admissions: the ward board, and the actions that change a stay.
 *
 * The actions hang off /encounters/:id because an admission is a *state* of an
 * encounter rather than a record of its own — the same reason the backend keeps
 * them on the encounter router.
 */
export const admissionApi = {
  list: (params) => api.get('/admissions', { params }),
  occupancy: (params) => api.get('/admissions/occupancy', { params }),

  admit: (encounterId, payload) => api.post(`/encounters/${encounterId}/admit`, payload),
  transfer: (encounterId, payload) => api.post(`/encounters/${encounterId}/transfer`, payload),
  discharge: (encounterId, payload) => api.post(`/encounters/${encounterId}/discharge`, payload),

  listRounds: (encounterId) => api.get(`/encounters/${encounterId}/rounds`),
  recordRound: (encounterId, payload) => api.post(`/encounters/${encounterId}/rounds`, payload),
};

export const DISCHARGE_TYPE_OPTIONS = [
  { value: 'recovered', label: 'Recovered' },
  { value: 'referred', label: 'Referred on' },
  { value: 'transferred', label: 'Transferred to another facility' },
  { value: 'lama', label: 'Left against medical advice' },
  { value: 'deceased', label: 'Deceased' },
];

export const CONSCIOUSNESS_OPTIONS = [
  { value: 'alert', label: 'Alert' },
  { value: 'voice', label: 'Responds to voice' },
  { value: 'pain', label: 'Responds to pain' },
  { value: 'unresponsive', label: 'Unresponsive' },
];

export const MOBILITY_OPTIONS = [
  { value: 'independent', label: 'Independent' },
  { value: 'assisted', label: 'Assisted' },
  { value: 'bed-bound', label: 'Bed-bound' },
];

export const RISK_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/** The checklist items a round records, as label/key pairs for the form. */
export const ROUND_CHECKS = [
  { key: 'repositioned', label: 'Repositioned' },
  { key: 'pressureAreasChecked', label: 'Pressure areas checked' },
  { key: 'hygieneAssisted', label: 'Hygiene assisted' },
  { key: 'medicationGiven', label: 'Medication given' },
  { key: 'ivLineChecked', label: 'IV line checked' },
  { key: 'catheterChecked', label: 'Catheter checked' },
];

export const BED_STATUS_TONES = {
  available: 'success',
  occupied: 'info',
  reserved: 'purple',
  cleaning: 'warning',
  maintenance: 'danger',
};

/** Colour the occupancy bar by pressure, not by brand. */
export function occupancyTone(rate) {
  if (rate >= 90) return 'bg-red-500';
  if (rate >= 75) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export default admissionApi;
