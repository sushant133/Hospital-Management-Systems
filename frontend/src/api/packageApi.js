import { api } from './client.js';

export const packageApi = {
  list: (params) => api.get('/billing/packages', { params }),
  get: (id) => api.get(`/billing/packages/${id}`),
  create: (payload) => api.post('/billing/packages', payload),
  update: (id, payload) => api.patch(`/billing/packages/${id}`, payload),
  retire: (id) => api.delete(`/billing/packages/${id}`),
  apply: (id, payload) => api.post(`/billing/packages/${id}/apply`, payload),
};

export default packageApi;
