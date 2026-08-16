import { api } from './client.js';

export const insuranceApi = {
  // Insurers
  listProviders: (params) => api.get('/insurance/providers', { params }),
  createProvider: (payload) => api.post('/insurance/providers', payload),
  updateProvider: (id, payload) => api.patch(`/insurance/providers/${id}`, payload),

  // Policies
  listPolicies: (params) => api.get('/insurance/policies', { params }),
  createPolicy: (payload) => api.post('/insurance/policies', payload),
  updatePolicy: (id, payload) => api.patch(`/insurance/policies/${id}`, payload),
  removePolicy: (id) => api.delete(`/insurance/policies/${id}`),
  eligibility: (id) => api.get(`/insurance/policies/${id}/eligibility`),
  verifyPolicy: (id, payload) => api.post(`/insurance/policies/${id}/verify`, payload ?? {}),

  // Pre-authorisations
  listPreAuths: (params) => api.get('/insurance/pre-authorizations', { params }),
  createPreAuth: (payload) => api.post('/insurance/pre-authorizations', payload),
  submitPreAuth: (id) => api.post(`/insurance/pre-authorizations/${id}/submit`, {}),
  preAuthDecision: (id, payload) => api.post(`/insurance/pre-authorizations/${id}/decision`, payload),

  // Claims
  previewClaim: (encounterId, policyId) =>
    api.get('/insurance/claims/preview', { params: { encounterId, policyId } }),
  listClaims: (params) => api.get('/insurance/claims', { params }),
  getClaim: (id) => api.get(`/insurance/claims/${id}`),
  createClaim: (payload) => api.post('/insurance/claims', payload),
  submitClaim: (id, payload) => api.post(`/insurance/claims/${id}/submit`, payload ?? {}),
  claimDecision: (id, payload) => api.post(`/insurance/claims/${id}/decision`, payload),
  settleClaim: (id, payload) => api.post(`/insurance/claims/${id}/settle`, payload),

  // Reports
  aging: (params) => api.get('/insurance/reports/aging', { params }),
  settlement: (params) => api.get('/insurance/reports/settlement', { params }),
};

export const POLICY_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
];

export const POLICY_STATUS_TONES = {
  active: 'success',
  expired: 'neutral',
  suspended: 'warning',
};

export const RELATIONSHIP_OPTIONS = [
  { value: 'self', label: 'Self' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'child', label: 'Child' },
  { value: 'parent', label: 'Parent' },
  { value: 'other', label: 'Other' },
];

export const CLAIM_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under-review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially-approved', label: 'Partially approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'resubmitted', label: 'Resubmitted' },
  { value: 'settled', label: 'Settled' },
];

export const CLAIM_STATUS_TONES = {
  draft: 'neutral',
  submitted: 'info',
  'under-review': 'info',
  approved: 'success',
  'partially-approved': 'warning',
  rejected: 'danger',
  resubmitted: 'purple',
  settled: 'success',
};

export const PREAUTH_STATUS_TONES = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  'partially-approved': 'warning',
  rejected: 'danger',
  expired: 'neutral',
};

/**
 * What the desk can do next, mirroring the server's transition tables so the UI
 * never offers an action the API will reject.
 */
export function claimActions(status) {
  return (
    {
      draft: ['submit'],
      submitted: ['decision'],
      'under-review': ['decision'],
      approved: ['settle'],
      'partially-approved': ['settle', 'resubmit'],
      rejected: ['resubmit'],
      resubmitted: ['decision'],
      settled: [],
    }[status] ?? []
  );
}

/** Aging buckets are coloured by how overdue the money is. */
export const BUCKET_TONES = {
  '0-30': 'success',
  '31-60': 'info',
  '61-90': 'warning',
  '90+': 'danger',
};

export default insuranceApi;
