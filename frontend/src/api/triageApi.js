import { api } from './client.js';

export const triageApi = {
  list: (params) => api.get('/triage', { params }),
  get: (id) => api.get(`/triage/${id}`),
  create: (payload) => api.post('/triage', payload),
  update: (id, payload) => api.patch(`/triage/${id}`, payload),
  assign: (id, payload) => api.post(`/triage/${id}/assign`, payload),
  dispose: (id, payload) => api.post(`/triage/${id}/disposition`, payload),
};

export const ESI_OPTIONS = [
  { value: 1, label: 'ESI 1 — Resuscitation' },
  { value: 2, label: 'ESI 2 — Emergent' },
  { value: 3, label: 'ESI 3 — Urgent' },
  { value: 4, label: 'ESI 4 — Less urgent' },
  { value: 5, label: 'ESI 5 — Non-urgent' },
];

export const ESI_TONES = { 1: 'danger', 2: 'warning', 3: 'info', 4: 'neutral', 5: 'success' };

export const TRIAGE_STATUS_OPTIONS = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'in-bay', label: 'In bay' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'lwbs', label: 'Left without being seen' },
  { value: 'transferred', label: 'Transferred' },
];

export const TRIAGE_STATUS_TONES = {
  waiting: 'warning',
  'in-bay': 'info',
  admitted: 'purple',
  discharged: 'success',
  lwbs: 'neutral',
  transferred: 'neutral',
};

export default triageApi;
