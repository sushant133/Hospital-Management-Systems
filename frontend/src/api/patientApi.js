import { api } from './client.js';

export const patientsApi = {
  list: (params) => api.get('/patients', { params }),
  get: (id) => api.get(`/patients/${id}`),
  create: (payload) => api.post('/patients', payload),
  /** MPI duplicate search — read-only, safe to call while the form is being typed. */
  checkDuplicates: (payload) => api.post('/patients/check-duplicates', payload),
  update: (id, payload) => api.patch(`/patients/${id}`, payload),
  updateMedicalHistory: (id, payload) => api.patch(`/patients/${id}/medical-history`, payload),
  encounters: (id, params) => api.get(`/patients/${id}/encounters`, { params }),
  deactivate: (id) => api.delete(`/patients/${id}`),
  restore: (id) => api.patch(`/patients/${id}/restore`, {}),
  merge: (id, payload) => api.post(`/patients/${id}/merge`, payload),
  invitePortal: (id, payload) => api.post(`/patients/${id}/portal-invite`, payload),
};

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export const BLOOD_GROUP_OPTIONS = [
  'unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-',
].map((value) => ({ value, label: value === 'unknown' ? 'Unknown' : value }));

export const MARITAL_STATUS_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];

export const PATIENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'deceased', label: 'Deceased' },
];

export const SEVERITY_OPTIONS = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
];

export const CONDITION_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'in-remission', label: 'In remission' },
];

export default patientsApi;
