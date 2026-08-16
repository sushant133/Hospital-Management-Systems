import { api } from './client.js';

export const staffApi = {
  /**
   * Colleagues, for assignment dropdowns — names, roles and specialisations
   * only. Readable by every signed-in role.
   *
   * Note this is NOT `/users`, which is the admin staff-management list and is
   * gated on `staff.view` (admin only). A receptionist booking an appointment
   * or a nurse naming an ordering clinician must use the directory.
   */
  directory: (params) => api.get('/users/directory', { params }),

  doctors: (params) => api.get('/users/directory', { params: { ...params, role: 'doctor' } }),

  // Admin employment record — email, role, status. Never use this in a
  // dropdown that a non-admin can open.
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (payload) => api.post('/users', payload),
  update: (id, payload) => api.patch(`/users/${id}`, payload),
  deactivate: (id) => api.delete(`/users/${id}`),
  restore: (id) => api.patch(`/users/${id}/restore`, {}),
  resetPassword: (id, payload) => api.post(`/users/${id}/reset-password`, payload),
};

export default staffApi;
