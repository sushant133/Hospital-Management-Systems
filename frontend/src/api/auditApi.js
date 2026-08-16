import { api } from './client.js';

export const auditApi = {
  list: (params) => api.get('/audit-logs', { params }),
  patient: (patientId, params) => api.get(`/audit-logs/patient/${patientId}`, { params }),
};

export const AUDIT_ACTION_OPTIONS = [
  { value: '', label: 'Any action' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'restore', label: 'Restore' },
  { value: 'view', label: 'View' },
  { value: 'login', label: 'Login' },
  { value: 'login_failed', label: 'Login failed' },
  { value: 'password_change', label: 'Password change' },
  { value: 'password_reset', label: 'Password reset' },
  { value: 'amend', label: 'Amend' },
  { value: 'cancel', label: 'Cancel' },
  { value: 'approve', label: 'Approve' },
  { value: 'override', label: 'Override' },
];

export const AUDIT_OUTCOME_OPTIONS = [
  { value: '', label: 'Any outcome' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
];

export default auditApi;
