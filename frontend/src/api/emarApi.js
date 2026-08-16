import { api } from './client.js';

export const emarApi = {
  list: (params) => api.get('/emar', { params }),
  record: (payload) => api.post('/emar', payload),
};

export const MAR_STATUS_OPTIONS = [
  { value: 'given', label: 'Given' },
  { value: 'held', label: 'Held' },
  { value: 'refused', label: 'Refused' },
  { value: 'missed', label: 'Missed' },
];

export const MAR_STATUS_TONES = {
  given: 'success',
  held: 'warning',
  refused: 'danger',
  missed: 'neutral',
};

export default emarApi;
