import { api } from './client.js';

/**
 * Attendance and payroll.
 *
 * Note the `/me` endpoints: they are separate calls, not the list endpoints
 * with a filter, because reading your own attendance and pay needs no grant
 * over anyone else's. The server draws the same line.
 */
export const payrollApi = {
  // Attendance — self-service
  myAttendance: (params) => api.get('/attendance/me', { params }),
  clockIn: (payload) => api.post('/attendance/clock-in', payload ?? {}),
  clockOut: (payload) => api.post('/attendance/clock-out', payload ?? {}),

  // Attendance — administration
  listAttendance: (params) => api.get('/attendance', { params }),
  attendanceSummary: (params) => api.get('/attendance/summary', { params }),
  recordAttendance: (payload) => api.post('/attendance', payload),
  approveAttendance: (id) => api.post(`/attendance/${id}/approve`, {}),

  // Shift roster — planned, as opposed to the register above (what happened).
  myRoster: (params) => api.get('/attendance/rosters/me', { params }),
  listRosters: (params) => api.get('/attendance/rosters', { params }),
  getRoster: (id) => api.get(`/attendance/rosters/${id}`),
  createRoster: (payload) => api.post('/attendance/rosters', payload),
  publishRoster: (id) => api.post(`/attendance/rosters/${id}/publish`, {}),
  unpublishRoster: (id) => api.post(`/attendance/rosters/${id}/unpublish`, {}),
  deleteRoster: (id) => api.delete(`/attendance/rosters/${id}`),
  assignShift: (id, payload) => api.post(`/attendance/rosters/${id}/assignments`, payload),
  clearShift: (id, assignmentId) => api.delete(`/attendance/rosters/${id}/assignments/${assignmentId}`),

  // Salary structures
  listStructures: (params) => api.get('/payroll/structures', { params }),
  createStructure: (payload) => api.post('/payroll/structures', payload),

  // Runs
  listRuns: (params) => api.get('/payroll/runs', { params }),
  getRun: (id) => api.get(`/payroll/runs/${id}`),
  createRun: (payload) => api.post('/payroll/runs', payload),
  rebuildRun: (id, payload) => api.post(`/payroll/runs/${id}/rebuild`, payload ?? {}),
  approveRun: (id, payload) => api.post(`/payroll/runs/${id}/approve`, payload ?? {}),
  payRun: (id, payload) => api.post(`/payroll/runs/${id}/pay`, payload ?? {}),
  cancelRun: (id, payload) => api.post(`/payroll/runs/${id}/cancel`, payload),

  // Payslips
  listPayslips: (params) => api.get('/payroll/payslips', { params }),
  myPayslips: () => api.get('/payroll/payslips/me'),
  getPayslip: (id) => api.get(`/payroll/payslips/${id}`),
};

export const ATTENDANCE_STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'half-day', label: 'Half day' },
  { value: 'leave', label: 'Leave' },
  { value: 'absent', label: 'Absent' },
];

export const ATTENDANCE_STATUS_TONES = {
  present: 'success',
  'half-day': 'warning',
  leave: 'info',
  absent: 'danger',
};

export const SHIFT_OPTIONS = [
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];

export const RUN_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const RUN_STATUS_TONES = {
  draft: 'neutral',
  approved: 'info',
  paid: 'success',
  cancelled: 'danger',
};

/**
 * What a run can do next, mirroring PAYROLL_TRANSITIONS on the server so the UI
 * never offers a button the API will reject.
 */
export function runActions(status) {
  return (
    {
      draft: ['rebuild', 'approve', 'cancel'],
      approved: ['pay', 'cancel'],
      paid: [],
      cancelled: [],
    }[status] ?? []
  );
}

/** The current month as YYYY-MM — the default period everywhere. */
export function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "March 2026" from "2026-03". */
export function periodLabel(period) {
  if (!period) return '—';
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export default payrollApi;
