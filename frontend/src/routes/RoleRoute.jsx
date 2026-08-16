import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import Spinner from '../components/ui/Spinner.jsx';

/**
 * Guards a subtree by role rather than by capability.
 *
 *   <Route element={<RoleRoute allow={[ROLES.ADMIN]} />}>
 *     <Route path="/admin" element={<AdminConsolePage />} />
 *   </Route>
 *
 * Prefer <ProtectedRoute require={[module, action]} /> for anything that maps
 * onto a capability — the permission matrix is the single source of truth and
 * survives role changes. Reach for this only where the *role itself* is the
 * subject, such as an admin-only console, and remember the API must enforce the
 * same restriction: this is a UX guard, not a security boundary.
 */
export function RoleRoute({ allow = [] }) {
  const { role, isAuthenticated, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your session…" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (allow.length && !allow.includes(role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
}

export default RoleRoute;
