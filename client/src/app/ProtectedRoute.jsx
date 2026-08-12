import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Spinner from '../components/ui/Spinner.jsx';

/**
 * Guards a route subtree.
 *
 *   <Route element={<ProtectedRoute require={['patients', 'view']} />}>
 *     <Route path="/patients" element={<PatientListPage />} />
 *   </Route>
 *
 * `require` is a [module, action] pair checked against the permissions the
 * server issued for this session. Omit it to require only that the user is
 * signed in.
 *
 * This is a UX guard — the API enforces the same matrix server-side, so a user
 * who hand-crafts a URL gets a 403 from the endpoint rather than data.
 */
export function ProtectedRoute({ require: required }) {
  const { isAuthenticated, bootstrapping, can } = useAuth();
  const location = useLocation();

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your session…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (required && !can(required[0], required[1])) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
