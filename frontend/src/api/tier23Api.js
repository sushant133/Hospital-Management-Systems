import { api } from './client.js';

export const portalApi = {
  login: (payload) => api.post('/portal/auth/login', payload),
  logout: () => api.post('/portal/auth/logout', {}),
  me: () => api.get('/portal/me'),
  doctors: () => api.get('/portal/doctors'),
  appointments: () => api.get('/portal/appointments'),
  slots: (params) => api.get('/portal/slots', { params }),
  book: (payload) => api.post('/portal/appointments', payload),
  results: () => api.get('/portal/results'),
  invoices: () => api.get('/portal/invoices'),
};

export const maternityApi = {
  listCases: (params) => api.get('/maternity/cases', { params }),
  getCase: (id) => api.get(`/maternity/cases/${id}`),
  createCase: (payload) => api.post('/maternity/cases', payload),
  updateCase: (id, payload) => api.patch(`/maternity/cases/${id}`, payload),
  addVisit: (id, payload) => api.post(`/maternity/cases/${id}/visits`, payload),
  listImmunizations: (params) => api.get('/maternity/immunizations', { params }),
  recordImmunization: (payload) => api.post('/maternity/immunizations', payload),
};

export const bloodApi = {
  listUnits: (params) => api.get('/blood-bank/units', { params }),
  registerUnit: (payload) => api.post('/blood-bank/units', payload),
  discardUnit: (id, payload) => api.post(`/blood-bank/units/${id}/discard`, payload ?? {}),
  listRequests: (params) => api.get('/blood-bank/requests', { params }),
  createRequest: (payload) => api.post('/blood-bank/requests', payload),
  crossmatch: (id, payload) => api.post(`/blood-bank/requests/${id}/crossmatch`, payload),
  issue: (id) => api.post(`/blood-bank/requests/${id}/issue`, {}),
};

export const purchaseApi = {
  listSuppliers: (params) => api.get('/purchase/suppliers', { params }),
  createSupplier: (payload) => api.post('/purchase/suppliers', payload),
  listOrders: (params) => api.get('/purchase/orders', { params }),
  getOrder: (id) => api.get(`/purchase/orders/${id}`),
  createOrder: (payload) => api.post('/purchase/orders', payload),
  submit: (id) => api.post(`/purchase/orders/${id}/submit`, {}),
  receive: (id, payload) => api.post(`/purchase/orders/${id}/receive`, payload),
  cancel: (id, payload) => api.post(`/purchase/orders/${id}/cancel`, payload ?? {}),
};

export const facilityApi = {
  list: (params) => api.get('/facilities', { params }),
  create: (payload) => api.post('/facilities', payload),
};

export const cdsApi = {
  patientView: (payload) => api.post('/cds-services/patient-view', payload),
};

export const hieApi = {
  listConsents: (params) => api.get('/hie/consents', { params }),
  grant: (payload) => api.post('/hie/consents', payload),
  revoke: (id) => api.post(`/hie/consents/${id}/revoke`, {}),
  exportBundle: (encounterId, payload) => api.post(`/hie/encounters/${encounterId}/bundle`, payload ?? {}),
};

export const remittanceApi = {
  list: (params) => api.get('/remittances', { params }),
  create: (payload) => api.post('/remittances', payload),
  post: (id) => api.post(`/remittances/${id}/post`, {}),
  exportClaim: (id) => api.get(`/remittances/claims/${id}/export`),
};

export const deviceApi = {
  list: (params) => api.get('/devices', { params }),
  create: (payload) => api.post('/devices', payload),
};

export const warehouseApi = {
  list: (params) => api.get('/reports/warehouse', { params }),
  rebuild: (payload) => api.post('/reports/warehouse', payload ?? {}),
};

export const fhirApi = {
  metadata: () => api.get('/fhir/metadata'),
  patient: (id) => api.get(`/fhir/Patient/${id}`),
};
