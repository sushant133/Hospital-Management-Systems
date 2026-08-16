import { useContext } from 'react';
import AuthContext from '../context/AuthContext.jsx';

/**
 * The session: `user`, `role`, `isAuthenticated`, `bootstrapping`, `can()`,
 * `canAccess()`, plus `login` / `logout` / `changePassword`.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return context;
}

export default useAuth;
