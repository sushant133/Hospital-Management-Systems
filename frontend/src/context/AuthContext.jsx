import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { setUnauthenticatedHandler } from '../api/client.js';
import { authApi } from '../api/authApi.js';
import { hasPermission, canAccessModule } from '../utils/permissions.js';

/**
 * Session state for the whole app.
 *
 * The consumer hook lives in hooks/useAuth.js rather than here, so components
 * depend on the hook and not on this module's internals.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /**
   * The user's effective permissions, as sent by the server. The client never
   * derives these from the role itself — see utils/permissions.js for why.
   */
  const [permissions, setPermissions] = useState(null);
  // `bootstrapping` is true until the initial /auth/me settles, so protected
  // routes don't flash the login page on a hard refresh with a valid cookie.
  const [bootstrapping, setBootstrapping] = useState(true);

  const clearSession = useCallback(() => {
    setUser(null);
    setPermissions(null);
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(clearSession);
    return () => setUnauthenticatedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await authApi.me();
        if (!cancelled) {
          setUser(response.data.user);
          setPermissions(response.data.permissions ?? null);
        }
      } catch {
        // No valid session — expected on first visit.
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    const response = await authApi.login(email, password);
    setUser(response.data.user);
    setPermissions(response.data.permissions ?? null);
    return response.data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const changePassword = useCallback(async (payload) => {
    const response = await authApi.changePassword(payload);
    setUser(response.data.user);
    setPermissions(response.data.permissions ?? null);
    return response.data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      permissions,
      isAuthenticated: Boolean(user),
      bootstrapping,
      /** `can('patients', 'create')` — the one check every component uses. */
      can: (module, action) => hasPermission(permissions, module, action),
      /** True if the user holds anything at all in the module. For nav filtering. */
      canAccess: (module) => canAccessModule(permissions, module),
      login,
      logout,
      changePassword,
    }),
    [user, permissions, bootstrapping, login, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;
