import { api } from './client.js';

export const theatreApi = {
  list: (params) => api.get('/theatre', { params }),
  get: (id) => api.get(`/theatre/${id}`),
  create: (payload) => api.post('/theatre', payload),
  update: (id, payload) => api.patch(`/theatre/${id}`, payload),
  start: (id) => api.post(`/theatre/${id}/start`, {}),
  complete: (id, payload) => api.post(`/theatre/${id}/complete`, payload ?? {}),
  cancel: (id, payload) => api.post(`/theatre/${id}/cancel`, payload),
};

export const THEATRE_ROOMS = [
  { value: 'OT-1', label: 'OT-1' },
  { value: 'OT-2', label: 'OT-2' },
  { value: 'OT-3', label: 'OT-3' },
];

export const SURGERY_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in-theatre', label: 'In theatre' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const SURGERY_STATUS_TONES = {
  scheduled: 'info',
  'in-theatre': 'warning',
  recovery: 'purple',
  completed: 'success',
  cancelled: 'danger',
};

export const PRIORITY_TONES = {
  elective: 'neutral',
  urgent: 'warning',
  emergency: 'danger',
};

export default theatreApi;
