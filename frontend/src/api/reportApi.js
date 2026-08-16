import { api, BASE_URL } from './client.js';

/**
 * Management reporting.
 *
 * Every report takes the same `{ from, to }` range, so callers pass one params
 * object around rather than each page inventing its own shape.
 */
export const reportApi = {
  /**
   * The dashboard. Unlike the reports below this is safe to call for ANY signed-in
   * role — the server returns only the sections the caller is entitled to, and an
   * empty list for a role with no reporting grants at all.
   */
  summary: () => api.get('/reports/summary'),

  revenue: (params) => api.get('/reports/revenue', { params }),
  occupancy: (params) => api.get('/reports/occupancy', { params }),
  inventory: (params) => api.get('/reports/inventory', { params }),
  attendance: (params) => api.get('/reports/attendance', { params }),
  departments: (params) => api.get('/reports/departments', { params }),
  clinical: (params) => api.get('/reports/clinical', { params }),
};

/**
 * Build the URL for a CSV download.
 *
 * The browser fetches this as a normal navigation so the session cookie rides
 * along and the file lands in Downloads — an XHR would put the bytes in memory
 * with nowhere useful to go.
 */
export function csvUrl(report, params = {}) {
  const search = new URLSearchParams(
    Object.entries({ ...params, format: 'csv' }).filter(([, v]) => v !== undefined && v !== ''),
  );
  return `${BASE_URL}/reports/${report}?${search.toString()}`;
}

/** The last N days as a `{ from, to }` pair of yyyy-mm-dd strings. */
export function lastDays(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export const RANGE_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '365 days', days: 365 },
];

/** Tabs, and the grant each one needs. Mirrors the route gates on the server. */
export const REPORT_TABS = [
  { key: 'revenue', label: 'Revenue', module: 'reports', action: 'viewFinancial' },
  { key: 'departments', label: 'Departments', module: 'reports', action: 'viewOperational' },
  { key: 'occupancy', label: 'Occupancy', module: 'reports', action: 'viewOperational' },
  { key: 'inventory', label: 'Inventory', module: 'reports', action: 'viewFinancial' },
  { key: 'clinical', label: 'Diagnostics', module: 'reports', action: 'viewClinical' },
  // Follows the data, not the page — see the route comment on the server.
  { key: 'attendance', label: 'Workforce', module: 'attendance', action: 'view' },
];

export default reportApi;
