import { api } from './client.js';

export const departmentsApi = {
  list: (params) => api.get('/departments', { params }),
  get: (id) => api.get(`/departments/${id}`),
  create: (payload) => api.post('/departments', payload),
  update: (id, payload) => api.patch(`/departments/${id}`, payload),
  deactivate: (id) => api.delete(`/departments/${id}`),
  restore: (id) => api.patch(`/departments/${id}/restore`, {}),
};

export default departmentsApi;
