import { api } from './client.js';

export const wardsApi = {
  list: (params) => api.get('/wards', { params }),
  get: (id) => api.get(`/wards/${id}`),
  create: (payload) => api.post('/wards', payload),
  update: (id, payload) => api.patch(`/wards/${id}`, payload),
  deactivate: (id) => api.delete(`/wards/${id}`),
  restore: (id) => api.patch(`/wards/${id}/restore`, {}),

  listBeds: (wardId, params) => api.get(`/wards/${wardId}/beds`, { params }),
  createBed: (wardId, payload) => api.post(`/wards/${wardId}/beds`, payload),
  createBedRange: (wardId, payload) => api.post(`/wards/${wardId}/beds/bulk`, payload),
  updateBed: (wardId, bedId, payload) => api.patch(`/wards/${wardId}/beds/${bedId}`, payload),
  deleteBed: (wardId, bedId) => api.delete(`/wards/${wardId}/beds/${bedId}`),
};

export const WARD_TYPE_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'private', label: 'Private' },
  { value: 'semi-private', label: 'Semi-private' },
  { value: 'icu', label: 'ICU' },
  { value: 'nicu', label: 'NICU' },
  { value: 'hdu', label: 'HDU' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'emergency', label: 'Emergency' },
];

export const WARD_GENDER_OPTIONS = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

/** 'occupied' is omitted — that transition belongs to the admission workflow. */
export const BED_STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'reserved', label: 'Reserved' },
];

export const BED_STATUS_TONES = {
  available: 'success',
  occupied: 'danger',
  reserved: 'warning',
  cleaning: 'info',
  maintenance: 'neutral',
};

export default wardsApi;
