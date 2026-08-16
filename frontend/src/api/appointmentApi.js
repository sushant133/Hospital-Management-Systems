import { api } from './client.js';

export const appointmentApi = {
  list: (params) => api.get('/appointments', { params }),
  get: (id) => api.get(`/appointments/${id}`),
  create: (payload) => api.post('/appointments', payload),
  update: (id, payload) => api.patch(`/appointments/${id}`, payload),
  remove: (id) => api.delete(`/appointments/${id}`),

  // Scheduling views
  slots: (doctorId, date) =>
    api.get('/appointments/slots', { params: { doctorId, date: toIsoDate(date) } }),
  schedule: (params) =>
    api.get('/appointments/schedule', { params: { ...params, date: toIsoDate(params.date) } }),
  queue: (params = {}) =>
    api.get('/appointments/queue', {
      params: { ...params, date: params.date ? toIsoDate(params.date) : undefined },
    }),

  // Lifecycle
  walkIn: (payload) => api.post('/appointments/walk-in', payload),
  reschedule: (id, payload) => api.post(`/appointments/${id}/reschedule`, payload),
  cancel: (id, payload) => api.post(`/appointments/${id}/cancel`, payload),
  noShow: (id, payload) => api.post(`/appointments/${id}/no-show`, payload ?? {}),
  checkIn: (id, payload) => api.post(`/appointments/${id}/check-in`, payload ?? {}),
  complete: (id) => api.post(`/appointments/${id}/complete`, {}),

  // Availability
  listAvailability: (params) => api.get('/appointments/availability', { params }),
  createAvailability: (payload) => api.post('/appointments/availability', payload),
  updateAvailability: (id, payload) => api.patch(`/appointments/availability/${id}`, payload),
  deleteAvailability: (id) => api.delete(`/appointments/availability/${id}`),
};

/** The API takes a full ISO instant; the pickers work in YYYY-MM-DD. */
function toIsoDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  // A bare 'YYYY-MM-DD' parses as UTC midnight, which lands on the previous day
  // in negative offsets — build it as a local date instead.
  const [y, m, d] = String(value).split('-').map(Number);
  if (y && m && d) return new Date(y, m - 1, d).toISOString();
  return new Date(value).toISOString();
}

export const APPOINTMENT_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'checked-in', label: 'Checked in' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no-show', label: 'No-show' },
  { value: 'rescheduled', label: 'Rescheduled' },
];

export const APPOINTMENT_TYPE_OPTIONS = [
  { value: 'consultation', label: 'Consultation' },
  { value: 'follow-up', label: 'Follow-up' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'review', label: 'Review' },
];

export const APPOINTMENT_STATUS_TONES = {
  scheduled: 'info',
  'checked-in': 'warning',
  completed: 'success',
  cancelled: 'danger',
  'no-show': 'danger',
  rescheduled: 'neutral',
};

export const DAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export const DAY_LABELS = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

/** YYYY-MM-DD for <input type="date">, in local time. */
export function toDateValue(date = new Date()) {
  const d = new Date(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** HH:MM for display, in local time. */
export function toTimeLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * What the desk can do next, mirroring the server's transition table so the UI
 * never offers an action the API will reject.
 */
export function availableActions(status) {
  return (
    {
      scheduled: ['checkIn', 'reschedule', 'cancel', 'noShow'],
      'checked-in': ['complete', 'cancel'],
      completed: [],
      cancelled: [],
      'no-show': [],
      rescheduled: [],
    }[status] ?? []
  );
}

export default appointmentApi;
