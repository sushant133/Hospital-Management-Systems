import { api, ApiRequestError } from './client.js';

async function uploadFiles(path, files) {
  const form = new FormData();
  for (const file of files) form.append('files', file);

  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiRequestError(error.message || `Request failed (${response.status})`, {
      status: response.status,
      code: error.code,
      details: error.details,
    });
  }
  return payload;
}

export const radiologyApi = {
  listExams: (params) => api.get('/radiology/exams', { params }),
  getExam: (id) => api.get(`/radiology/exams/${id}`),
  createExam: (payload) => api.post('/radiology/exams', payload),
  updateExam: (id, payload) => api.patch(`/radiology/exams/${id}`, payload),
  retireExam: (id) => api.delete(`/radiology/exams/${id}`),

  listOrders: (params) => api.get('/radiology/orders', { params }),
  getOrder: (id) => api.get(`/radiology/orders/${id}`),
  createOrder: (payload) => api.post('/radiology/orders', payload),
  schedule: (id, payload) => api.post(`/radiology/orders/${id}/schedule`, payload),
  start: (id, payload) => api.post(`/radiology/orders/${id}/start`, payload ?? {}),
  cancel: (id, payload) => api.post(`/radiology/orders/${id}/cancel`, payload ?? {}),

  submitResult: (id, payload) => api.post(`/radiology/orders/${id}/result`, payload),
  amendResult: (id, payload) => api.post(`/radiology/orders/${id}/result/amend`, payload),
  listResults: (params) => api.get('/radiology/results', { params }),

  attachImages: (id, files) => uploadFiles(`/radiology/orders/${id}/attachments`, files),
  removeAttachment: (id, attachmentId) =>
    api.delete(`/radiology/orders/${id}/attachments/${attachmentId}`),
  attachmentUrl: (id, attachmentId) => `/api/v1/radiology/orders/${id}/attachments/${attachmentId}`,

  reportUrl: (id) => `/api/v1/radiology/orders/${id}/report`,
  regenerateReport: (id) => api.post(`/radiology/orders/${id}/report`, {}),
};

export const RAD_STATUS_OPTIONS = [
  { value: 'ordered', label: 'Ordered' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const RAD_PRIORITY_OPTIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'stat', label: 'STAT' },
];

export const MODALITY_OPTIONS = [
  { value: 'xray', label: 'X-ray' },
  { value: 'ct', label: 'CT' },
  { value: 'mri', label: 'MRI' },
  { value: 'ultrasound', label: 'Ultrasound' },
  { value: 'mammography', label: 'Mammography' },
  { value: 'fluoroscopy', label: 'Fluoroscopy' },
  { value: 'nuclear', label: 'Nuclear medicine' },
];

export const RAD_STATUS_TONES = {
  ordered: 'neutral',
  scheduled: 'info',
  'in-progress': 'warning',
  completed: 'success',
  cancelled: 'danger',
};

export const PRIORITY_TONES = {
  routine: 'neutral',
  urgent: 'warning',
  stat: 'danger',
};

export const MODALITY_LABELS = Object.fromEntries(MODALITY_OPTIONS.map((o) => [o.value, o.label]));

/** Next legal action for an order, mirroring the server's transition table. */
export function nextAction(status) {
  return (
    {
      ordered: { action: 'schedule', label: 'Schedule study' },
      scheduled: { action: 'start', label: 'Start study' },
      'in-progress': null,
      completed: null,
      cancelled: null,
    }[status] ?? null
  );
}

export default radiologyApi;
