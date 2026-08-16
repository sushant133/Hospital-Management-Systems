import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { MODULES } from '../utils/permissions.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * Navigation is filtered by permission, not by role, so it can never disagree
 * with what the API will actually allow — both read the same matrix.
 *
 * `module` is the permission module the item needs any grant in. Add `action`
 * where "any grant" is too loose: every role holds `payroll.viewOwn`, so a bare
 * module check would offer the payroll office to a nurse who would then be
 * bounced by the route guard. `phase` marks items whose modules land in a later
 * build phase, rendered disabled so the roadmap stays visible without being
 * clickable.
 */
const NAV_SECTIONS = [
  {
    heading: null,
    items: [
      { to: '/', label: 'Dashboard', i18n: 'dashboard', icon: '🏠', end: true },
      { to: '/reports', label: 'Reports', i18n: 'reports', icon: '📊', module: MODULES.REPORTS },
    ],
  },
  {
    heading: 'Clinical',
    headingKey: 'clinical',
    items: [
      { to: '/patients', label: 'Patients', i18n: 'patients', icon: '🧑‍⚕️', module: MODULES.PATIENTS },
      { to: '/appointments', label: 'Appointments', i18n: 'appointments', icon: '📅', module: MODULES.APPOINTMENTS },
      { to: '/admissions', label: 'Admissions', i18n: 'admissions', icon: '🛏️', module: MODULES.BEDS },
      { to: '/emergency', label: 'Emergency', i18n: 'emergency', icon: '🚨', module: MODULES.TRIAGE },
      { to: '/theatre', label: 'Theatre', i18n: 'theatre', icon: '🩺', module: MODULES.THEATRE },
      { to: '/maternity', label: 'Maternity', i18n: 'maternity', icon: '🤰', module: MODULES.MATERNITY },
      { to: '/blood-bank', label: 'Blood bank', i18n: 'bloodBank', icon: '🩸', module: MODULES.BLOOD_BANK },
    ],
  },
  {
    heading: 'Diagnostics',
    headingKey: 'diagnostics',
    items: [
      { to: '/lab', label: 'Laboratory', i18n: 'laboratory', icon: '🧪', module: MODULES.LAB_ORDERS },
      { to: '/radiology', label: 'Radiology', i18n: 'radiology', icon: '🩻', module: MODULES.RADIOLOGY_ORDERS },
      { to: '/radiology/dicom', label: 'DICOM store', i18n: 'dicom', icon: '💾', module: MODULES.DICOM },
    ],
  },
  {
    heading: 'Operations',
    headingKey: 'operations',
    items: [
      { to: '/pharmacy', label: 'Pharmacy', i18n: 'pharmacy', icon: '💊', module: MODULES.DISPENSING },
      { to: '/pharmacy/inventory', label: 'Drug inventory', icon: '📦', module: MODULES.DRUGS },
      { to: '/inventory', label: 'Store & assets', icon: '🧰', module: MODULES.INVENTORY },
      { to: '/purchase', label: 'Purchase orders', i18n: 'purchase', icon: '🛒', module: MODULES.PURCHASE },
      { to: '/billing', label: 'Billing', i18n: 'billing', icon: '🧾', module: MODULES.INVOICES },
      { to: '/billing/packages', label: 'Packages', i18n: 'packages', icon: '📦', module: MODULES.BILLING_PACKAGES },
      { to: '/billing/payments', label: 'Payments', i18n: 'payments', icon: '💰', module: MODULES.PAYMENTS },
      { to: '/insurance', label: 'Insurance', i18n: 'insurance', icon: '🛡️', module: MODULES.CLAIMS },
      { to: '/insurance/policies', label: 'Policies', i18n: 'policies', icon: '📄', module: MODULES.PATIENT_POLICIES },
      { to: '/payroll', label: 'Payroll', i18n: 'payroll', icon: '👥', module: MODULES.PAYROLL, action: 'view' },
    ],
  },
  {
    heading: 'Me',
    headingKey: 'me',
    items: [
      { to: '/my-pay', label: 'My pay', i18n: 'myPay', icon: '🪪', module: MODULES.PAYROLL, action: 'viewOwn' },
    ],
  },
  {
    heading: 'Administration',
    headingKey: 'administration',
    items: [
      { to: '/departments', label: 'Departments', i18n: 'departments', icon: '🏢', module: MODULES.DEPARTMENTS },
      { to: '/wards', label: 'Wards & Beds', i18n: 'wards', icon: '🏥', module: MODULES.WARDS },
      { to: '/hie', label: 'HIE / consent', i18n: 'hie', icon: '🔗', module: MODULES.HIE },
      { to: '/devices', label: 'Devices', i18n: 'devices', icon: '🔌', module: MODULES.DEVICES },
      { to: '/warehouse', label: 'Warehouse', i18n: 'warehouse', icon: '📈', module: MODULES.WAREHOUSE },
      { to: '/staff', label: 'Staff Accounts', i18n: 'staff', icon: '🔑', module: MODULES.STAFF, action: 'view' },
      { to: '/attendance', label: 'Attendance', i18n: 'attendance', icon: '🕒', module: MODULES.ATTENDANCE, action: 'view' },
      { to: '/attendance/roster', label: 'Shift roster', i18n: 'roster', icon: '🗓️', module: MODULES.ATTENDANCE, action: 'manageShifts' },
      { to: '/audit', label: 'Audit Log', i18n: 'audit', icon: '📜', module: MODULES.AUDIT_LOGS, action: 'view' },
    ],
  },
];

function NavItem({ item, t }) {
  const base =
    'group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors';
  const label = item.i18n ? t(item.i18n) : item.label;

  if (item.phase) {
    return (
      <span
        className={`${base} cursor-not-allowed text-slate-400`}
        title={`Arrives in Phase ${item.phase}`}
      >
        <span aria-hidden="true">{item.icon}</span>
        <span className="flex-1">{label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          P{item.phase}
        </span>
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          base,
          isActive
            ? 'bg-brand-50 font-semibold text-brand-800'
            : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {/*
            A left stripe on the active item, not only a background tint.
            Position down the rail is readable at a glance and survives a
            washed-out screen, where a pale tint on white does not.
          */}
          {isActive && (
            <span
              className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-brand-600"
              aria-hidden="true"
            />
          )}
          {/* Fixed-width icon column, so labels align rather than ragging. */}
          <span className="w-5 shrink-0 text-center text-[15px] opacity-80" aria-hidden="true">
            {item.icon}
          </span>
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ open, onClose }) {
  const { can, canAccess } = useAuth();
  const { t } = useI18n();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      // No `module` means the item is available to anyone signed in (Dashboard).
      if (!item.module) return true;
      return item.action ? can(item.module, item.action) : canAccess(item.module);
    }),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/*
        On mobile the sidebar is a `fixed` drawer that slides over the page.

        On desktop it must stay put while the main column scrolls. `lg:static`
        alone does not do that: a static flex child moves with the page, so a
        long patient list dragged the whole menu off the top of the screen.
        `lg:sticky lg:top-0` pins it to the viewport, and `lg:h-screen` bounds it
        so the nav inside gets its own scrollbar rather than overflowing.
      */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform',
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-base text-white" aria-hidden="true">
            🏥
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">HMS</p>
            <p className="truncate text-xs text-slate-500">{t('appName')}</p>
          </div>
        </div>

        {/* `flex-1` takes whatever the brand header leaves, so the nav scrolls
            internally without the layout depending on a magic 4rem. */}
        <nav className="scroll-slim flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
          {sections.map((section) => (
            <div key={section.heading ?? 'root'}>
              {section.heading && (
                <p className="eyebrow mb-1.5 px-3 text-slate-400">
                  {section.headingKey ? t(section.headingKey) : section.heading}
                </p>
              )}
              <div className="space-y-0.5" onClick={onClose}>
                {section.items.map((item) => (
                  <NavItem key={item.to} item={item} t={t} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

export default Sidebar;
