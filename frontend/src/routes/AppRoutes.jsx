import { Link, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute.jsx';
import { MODULES } from '../utils/permissions.js';
import AuthLayout from '../layouts/AuthLayout.jsx';
import DashboardLayout from '../layouts/DashboardLayout.jsx';
import { Button, EmptyState } from '../components/ui/index.js';

import LoginPage from '../features/auth/pages/LoginPage.jsx';
import DashboardPage from '../features/dashboard/pages/DashboardPage.jsx';
import PatientListPage from '../features/patients/pages/PatientListPage.jsx';
import PatientFormPage from '../features/patients/pages/PatientFormPage.jsx';
import PatientDetailPage from '../features/patients/pages/PatientDetailPage.jsx';
import AdmissionsPage from '../features/admissions/pages/AdmissionsPage.jsx';
import EncounterPage from '../features/ehr/pages/EncounterPage.jsx';
import PatientTimelinePage from '../features/ehr/pages/PatientTimelinePage.jsx';
import CalendarPage from '../features/appointments/pages/CalendarPage.jsx';
import BookAppointmentPage from '../features/appointments/pages/BookAppointmentPage.jsx';
import AvailabilityPage from '../features/appointments/pages/AvailabilityPage.jsx';
import DepartmentsPage from '../features/departments/pages/DepartmentsPage.jsx';
import WardsPage from '../features/wards/pages/WardsPage.jsx';
import WardBedsPage from '../features/wards/pages/WardBedsPage.jsx';
import LabWorklistPage from '../features/lab/pages/LabWorklistPage.jsx';
import LabOrderDetailPage from '../features/lab/pages/LabOrderDetailPage.jsx';
import LabCatalogPage from '../features/lab/pages/LabCatalogPage.jsx';
import RadiologyWorklistPage from '../features/radiology/pages/RadiologyWorklistPage.jsx';
import RadiologyOrderDetailPage from '../features/radiology/pages/RadiologyOrderDetailPage.jsx';
import RadiologyCatalogPage from '../features/radiology/pages/RadiologyCatalogPage.jsx';
import DispensePage from '../features/pharmacy/pages/DispensePage.jsx';
import DrugInventoryPage from '../features/pharmacy/pages/DrugInventoryPage.jsx';
import InventoryListPage from '../features/inventory/pages/InventoryListPage.jsx';
import InvoicePage from '../features/billing/pages/InvoicePage.jsx';
import PaymentHistoryPage from '../features/billing/pages/PaymentHistoryPage.jsx';
import ClaimsPage from '../features/insurance/pages/ClaimsPage.jsx';
import PolicyLinkPage from '../features/insurance/pages/PolicyLinkPage.jsx';
import PayrollRunPage from '../features/payroll/pages/PayrollRunPage.jsx';
import PayslipPage from '../features/payroll/pages/PayslipPage.jsx';
import AttendancePage from '../features/payroll/pages/AttendancePage.jsx';
import RosterPage from '../features/staff/pages/RosterPage.jsx';
import StaffPage from '../features/staff/pages/StaffPage.jsx';
import ReportsPage from '../features/dashboard/pages/ReportsPage.jsx';
import AuditLogPage from '../features/audit/pages/AuditLogPage.jsx';
import TheatrePage from '../features/theatre/pages/TheatrePage.jsx';
import SurgeryDetailPage from '../features/theatre/pages/SurgeryDetailPage.jsx';
import EmergencyPage from '../features/emergency/pages/EmergencyPage.jsx';
import DicomPage from '../features/radiology/pages/DicomPage.jsx';
import PackagesPage from '../features/billing/pages/PackagesPage.jsx';
import MaternityPage from '../features/maternity/pages/MaternityPage.jsx';
import BloodBankPage from '../features/blood/pages/BloodBankPage.jsx';
import PurchasePage from '../features/purchase/pages/PurchasePage.jsx';
import HiePage from '../features/hie/pages/HiePage.jsx';
import DevicesPage, { WarehousePage } from '../features/ops/pages/DevicesPage.jsx';
import PortalLoginPage from '../features/portal/PortalLoginPage.jsx';
import PortalHomePage from '../features/portal/PortalHomePage.jsx';

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

export function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route path="/portal" element={<PortalHomePage />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />

          {/* Every guard below names a capability, never a role. The same
              (module, action) pair gates the matching API route. */}
          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'view']} />}>
            <Route path="patients" element={<PatientListPage />} />
            <Route path="patients/:id" element={<PatientDetailPage />} />
          </Route>

          {/* The clinical record. The timeline needs only patient read — it
              filters each strand by the caller's own grants server-side. */}
          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'view']} />}>
            <Route path="patients/:id/timeline" element={<PatientTimelinePage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.ENCOUNTERS, 'view']} />}>
            <Route path="encounters/:id" element={<EncounterPage />} />
          </Route>

          {/* The bed board reports capacity, not patients, so every role may
              read it — the admitted list inside is gated separately. */}
          <Route element={<ProtectedRoute require={[MODULES.BEDS, 'view']} />}>
            <Route path="admissions" element={<AdmissionsPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'create']} />}>
            <Route path="patients/new" element={<PatientFormPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PATIENTS, 'edit']} />}>
            <Route path="patients/:id/edit" element={<PatientFormPage />} />
          </Route>

          {/* Scheduling. Booking and availability are gated more narrowly than
              the day view, matching the API. */}
          <Route element={<ProtectedRoute require={[MODULES.APPOINTMENTS, 'view']} />}>
            <Route path="appointments" element={<CalendarPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.APPOINTMENTS, 'create']} />}>
            <Route path="appointments/new" element={<BookAppointmentPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.APPOINTMENTS, 'manageAvailability']} />}>
            <Route path="appointments/availability" element={<AvailabilityPage />} />
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

          <Route element={<ProtectedRoute require={[MODULES.RADIOLOGY_ORDERS, 'view']} />}>
            <Route path="radiology" element={<RadiologyWorklistPage />} />
            <Route path="radiology/orders/:id" element={<RadiologyOrderDetailPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.RADIOLOGY_EXAMS, 'edit']} />}>
            <Route path="radiology/catalog" element={<RadiologyCatalogPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.DICOM, 'view']} />}>
            <Route path="radiology/dicom" element={<DicomPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.THEATRE, 'view']} />}>
            <Route path="theatre" element={<TheatrePage />} />
            <Route path="theatre/:id" element={<SurgeryDetailPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.TRIAGE, 'view']} />}>
            <Route path="emergency" element={<EmergencyPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.MATERNITY, 'view']} />}>
            <Route path="maternity" element={<MaternityPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.BLOOD_BANK, 'view']} />}>
            <Route path="blood-bank" element={<BloodBankPage />} />
          </Route>

          {/* Pharmacy. Dispensing and the inventory are gated separately —
              a doctor may read the formulary but not fill a prescription. */}
          <Route element={<ProtectedRoute require={[MODULES.DISPENSING, 'view']} />}>
            <Route path="pharmacy" element={<DispensePage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.DRUGS, 'view']} />}>
            <Route path="pharmacy/inventory" element={<DrugInventoryPage />} />
          </Route>

          {/* Billing. Invoices and payments are gated apart — reception may take
              money without being able to void a bill. */}
          <Route element={<ProtectedRoute require={[MODULES.INVOICES, 'view']} />}>
            <Route path="billing" element={<InvoicePage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.BILLING_PACKAGES, 'view']} />}>
            <Route path="billing/packages" element={<PackagesPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PAYMENTS, 'view']} />}>
            <Route path="billing/payments" element={<PaymentHistoryPage />} />
          </Route>

          {/* Insurance. Policies are front-desk work; claims are the finance office. */}
          <Route element={<ProtectedRoute require={[MODULES.PATIENT_POLICIES, 'view']} />}>
            <Route path="insurance/policies" element={<PolicyLinkPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.CLAIMS, 'view']} />}>
            <Route path="insurance" element={<ClaimsPage />} />
          </Route>

          {/* Payroll. `viewOwn` is held by every role, so "My pay" is reachable
              by anyone signed in — while the run office needs `payroll.view`,
              which only finance and admin hold. */}
          <Route element={<ProtectedRoute require={[MODULES.PAYROLL, 'viewOwn']} />}>
            <Route path="my-pay" element={<PayslipPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PAYROLL, 'view']} />}>
            <Route path="payroll" element={<PayrollRunPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.ATTENDANCE, 'view']} />}>
            <Route path="attendance" element={<AttendancePage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.ATTENDANCE, 'manageShifts']} />}>
            <Route path="attendance/roster" element={<RosterPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.STAFF, 'view']} />}>
            <Route path="staff" element={<StaffPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.AUDIT_LOGS, 'view']} />}>
            <Route path="audit" element={<AuditLogPage />} />
          </Route>

          {/* Reporting. Reachable with ANY of the three reporting grants — the
              page then shows only the tabs that grant actually covers, matching
              the per-report gates on the server. */}
          <Route
            element={
              <ProtectedRoute
                require={[MODULES.REPORTS, ['viewOperational', 'viewFinancial', 'viewClinical']]}
              />
            }
          >
            <Route path="reports" element={<ReportsPage />} />
          </Route>

          {/* The general store — non-drug consumables and assets. */}
          <Route element={<ProtectedRoute require={[MODULES.INVENTORY, 'view']} />}>
            <Route path="inventory" element={<InventoryListPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.PURCHASE, 'view']} />}>
            <Route path="purchase" element={<PurchasePage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.HIE, 'view']} />}>
            <Route path="hie" element={<HiePage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.DEVICES, 'view']} />}>
            <Route path="devices" element={<DevicesPage />} />
          </Route>

          <Route element={<ProtectedRoute require={[MODULES.WAREHOUSE, 'view']} />}>
            <Route path="warehouse" element={<WarehousePage />} />
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

export default AppRoutes;
