import { api } from './client.js';

export const pharmacyApi = {
  // Formulary
  listDrugs: (params) => api.get('/pharmacy/drugs', { params }),
  getDrug: (id) => api.get(`/pharmacy/drugs/${id}`),
  createDrug: (payload) => api.post('/pharmacy/drugs', payload),
  updateDrug: (id, payload) => api.patch(`/pharmacy/drugs/${id}`, payload),
  retireDrug: (id) => api.delete(`/pharmacy/drugs/${id}`),

  // Stock
  listBatches: (params) => api.get('/pharmacy/batches', { params }),
  receiveBatch: (payload) => api.post('/pharmacy/batches', payload),
  adjustBatch: (id, payload) => api.post(`/pharmacy/batches/${id}/adjust`, payload),
  alerts: (params) => api.get('/pharmacy/alerts', { params }),

  // Prescribing
  listPrescriptions: (params) => api.get('/pharmacy/prescriptions', { params }),
  getPrescription: (id) => api.get(`/pharmacy/prescriptions/${id}`),
  createPrescription: (payload) => api.post('/pharmacy/prescriptions', payload),
  cancelPrescription: (id, payload) => api.post(`/pharmacy/prescriptions/${id}/cancel`, payload ?? {}),

  // Dispensing
  previewDispense: (id) => api.get(`/pharmacy/prescriptions/${id}/dispense-preview`),
  dispense: (id, payload) => api.post(`/pharmacy/prescriptions/${id}/dispense`, payload ?? {}),
  listDispenses: (params) => api.get('/pharmacy/dispenses', { params }),
  returnDispense: (id, payload) => api.post(`/pharmacy/dispenses/${id}/return`, payload),
};

export const DRUG_FORM_OPTIONS = [
  'tablet', 'capsule', 'syrup', 'suspension', 'injection', 'infusion',
  'cream', 'ointment', 'drops', 'inhaler', 'suppository', 'patch', 'other',
].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

export const ROUTE_OPTIONS = [
  { value: 'oral', label: 'Oral' },
  { value: 'iv', label: 'Intravenous' },
  { value: 'im', label: 'Intramuscular' },
  { value: 'sc', label: 'Subcutaneous' },
  { value: 'topical', label: 'Topical' },
  { value: 'inhalation', label: 'Inhalation' },
  { value: 'rectal', label: 'Rectal' },
  { value: 'ophthalmic', label: 'Ophthalmic' },
  { value: 'otic', label: 'Otic' },
  { value: 'nasal', label: 'Nasal' },
  { value: 'sublingual', label: 'Sublingual' },
];

export const PRESCRIPTION_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'partially-dispensed', label: 'Partially dispensed' },
  { value: 'dispensed', label: 'Dispensed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const PRESCRIPTION_STATUS_TONES = {
  pending: 'warning',
  'partially-dispensed': 'info',
  dispensed: 'success',
  cancelled: 'neutral',
};

export const BATCH_STATUS_TONES = {
  active: 'success',
  expired: 'danger',
  quarantined: 'warning',
  depleted: 'neutral',
};

export const ADJUST_ACTIONS = [
  { value: 'write-off', label: 'Write off stock' },
  { value: 'quarantine', label: 'Quarantine batch' },
  { value: 'release', label: 'Release from quarantine' },
  { value: 'mark-expired', label: 'Mark expired' },
];

/** Days until a date — negative once it has passed. */
export function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / 86400000);
}

/** How urgently an expiry should read: red once gone, amber inside 30 days. */
export function expiryTone(date) {
  const days = daysUntil(date);
  if (days === null) return 'neutral';
  if (days <= 0) return 'danger';
  if (days <= 30) return 'warning';
  if (days <= 90) return 'info';
  return 'neutral';
}

export default pharmacyApi;
