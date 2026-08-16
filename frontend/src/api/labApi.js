import { api } from './client.js';

export const labApi = {
  // Catalogue
  listTests: (params) => api.get('/lab/tests', { params }),
  getTest: (id) => api.get(`/lab/tests/${id}`),
  createTest: (payload) => api.post('/lab/tests', payload),
  updateTest: (id, payload) => api.patch(`/lab/tests/${id}`, payload),
  retireTest: (id) => api.delete(`/lab/tests/${id}`),

  // Orders
  listOrders: (params) => api.get('/lab/orders', { params }),
  getOrder: (id) => api.get(`/lab/orders/${id}`),
  createOrder: (payload) => api.post('/lab/orders', payload),
  collect: (id, payload) => api.post(`/lab/orders/${id}/collect`, payload ?? {}),
  start: (id) => api.post(`/lab/orders/${id}/start`, {}),
  cancel: (id, payload) => api.post(`/lab/orders/${id}/cancel`, payload ?? {}),

  // Results
  submitResult: (id, payload) => api.post(`/lab/orders/${id}/results`, payload),
  amendResult: (id, resultId, payload) =>
    api.post(`/lab/orders/${id}/results/${resultId}/amend`, payload),
  listResults: (params) => api.get('/lab/results', { params }),

  // Report — opened in a new tab; the cookie authenticates the request.
  reportUrl: (id) => `/api/v1/lab/orders/${id}/report`,
  regenerateReport: (id) => api.post(`/lab/orders/${id}/report`, {}),

  ingestHl7: (message) => api.post('/lab/inbound/hl7', { message }),
};

export const billingApi = {
  lineItems: (params) => api.get('/billing/line-items', { params }),
};

export const LAB_STATUS_OPTIONS = [
  { value: 'ordered', label: 'Ordered' },
  { value: 'collected', label: 'Collected' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const LAB_PRIORITY_OPTIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'stat', label: 'STAT' },
];

export const SPECIMEN_OPTIONS = [
  'blood', 'serum', 'plasma', 'urine', 'stool', 'sputum', 'swab', 'csf', 'tissue', 'other',
].map((value) => ({ value, label: value.toUpperCase() }));

export const LAB_STATUS_TONES = {
  ordered: 'neutral',
  collected: 'info',
  'in-progress': 'warning',
  completed: 'success',
  cancelled: 'danger',
};

export const PRIORITY_TONES = {
  routine: 'neutral',
  urgent: 'warning',
  stat: 'danger',
};

export const FLAG_TONES = {
  normal: 'success',
  low: 'warning',
  high: 'warning',
  'critical-low': 'danger',
  'critical-high': 'danger',
  abnormal: 'warning',
};

export const FLAG_LABELS = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  'critical-low': 'Critical low',
  'critical-high': 'Critical high',
  abnormal: 'Abnormal',
};

/** Next legal action for an order, mirroring the server's transition table. */
export function nextAction(status) {
  return (
    {
      ordered: { action: 'collect', label: 'Mark sample collected' },
      collected: { action: 'start', label: 'Start processing' },
      'in-progress': null,
      completed: null,
      cancelled: null,
    }[status] ?? null
  );
}

export default labApi;
