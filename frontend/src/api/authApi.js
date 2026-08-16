import { api } from './client.js';

/**
 * Session endpoints. These were inline in AuthContext before the api/ layer
 * existed — the context now owns session *state*, this module owns the calls.
 *
 * Every response carries `{ user, permissions }`: the server is the only thing
 * that decides what a session may do (see utils/permissions.js).
 */
export const authApi = {
  /** Current session from the httpOnly cookie. Rejects when there isn't one. */
  me: () => api.get('/auth/me'),

  login: (email, password) => api.post('/auth/login', { email, password }),

  logout: () => api.post('/auth/logout'),

  changePassword: (payload) => api.post('/auth/change-password', payload),
};

export default authApi;
