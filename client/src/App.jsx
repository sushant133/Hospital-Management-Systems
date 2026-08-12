import { Link, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './app/ProtectedRoute.jsx';
import { MODULES } from './app/permissions.js';
import Layout from './components/Layout.jsx';
import { Button, EmptyState } from './components/ui/index.js';

import LoginPage from './features/auth/LoginPage.jsx';
import DashboardPage from './features/dashboard/DashboardPage.jsx';
import PatientListPage from './features/patients/PatientListPage.jsx';
import PatientFormPage from './features/patients/PatientFormPage.jsx';
import PatientDetailPage from './features/patients/PatientDetailPage.jsx';
import DepartmentsPage from './features/departments/DepartmentsPage.jsx';
import WardsPage from './features/wards/WardsPage.jsx';
import WardBedsPage from './features/wards/WardBedsPage.jsx';
import LabWorklistPage from './features/lab/LabWorklistPage.jsx';
import LabOrderDetailPage from './features/lab/LabOrderDetailPage.jsx';
import LabCatalogPage from './features/lab/LabCatalogPage.jsx';

function CenteredMessage({ icon, title, description }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          action={
            <Link to="/">
              <Button>Back to dashboard</Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />

          {/* Every guard below names a capability, never a role. The same
              (module, action) pair gates the matching API route. */}
          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'view']} />}>
            <Route path="patients" element={<PatientListPage />} />
            <Route path="patients/:id" element={<PatientDetailPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'create']} />}>
            <Route path="patients/new" element={<PatientFormPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'edit']} />}>
            <Route path="patients/:id/edit" element={<PatientFormPage />} />
          </Route>

          {/* Facility reference data — every role can read; write is gated
              inside the page (and by the API). */}
          <Route element={<ProtectedRoute require={[MODULES.DEPARTMENTS, 'view']} />}>
            <Route path="departments" element={<DepartmentsPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.WARDS, 'view']} />}>
            <Route path="wards" element={<WardsPage />} />
            <Route path="wards/:id" element={<WardBedsPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.LAB_ORDERS, 'view']} />}>
            <Route path="lab" element={<LabWorklistPage />} />
            <Route path="lab/orders/:id" element={<LabOrderDetailPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.LAB_TESTS, 'edit']} />}>
            <Route path="lab/catalog" element={<LabCatalogPage />} />
          </Route>

          <Route
            path="forbidden"
            element={
              <EmptyState
                icon="🔒"
                title="You don't have access to that page"
                description="Your role doesn't include permission for this area. Contact an administrator if you believe this is a mistake."
                action={
                  <Link to="/">
                    <Button>Back to dashboard</Button>
                  </Link>
                }
              />
            }
          />

          <Route
            path="*"
            element={
              <EmptyState
                icon="🧭"
                title="Page not found"
                description="That route doesn't exist. It may belong to a module that hasn't been built yet."
                action={
                  <Link to="/">
                    <Button>Back to dashboard</Button>
                  </Link>
                }
              />
            }
          />
        </Route>
      </Route>

      {/* Unauthenticated fallback */}
      <Route
        path="*"
        element={<CenteredMessage icon="🧭" title="Page not found" description="That route doesn't exist." />}
      />
    </Routes>
  );
}

export default App;
