import { NavLink } from 'react-router-dom';
import { useAuth } from '../app/AuthContext.jsx';
import { MODULES } from '../app/permissions.js';

/**
 * Navigation is filtered by permission, not by role, so it can never disagree
 * with what the API will actually allow — both read the same matrix.
 *
 * `module` is the permission module the item needs any grant in; `phase` marks
 * items whose modules land in a later build phase, rendered disabled so the
 * roadmap stays visible without being clickable.
 */
const NAV_SECTIONS = [
  {
    heading: null,
    items: [{ to: '/', label: 'Dashboard', icon: '🏠', end: true }],
  },
  {
    heading: 'Clinical',
    items: [
      { to: '/patients', label: 'Patients', icon: '🧑‍⚕️', module: MODULES.PATIENTS },
      { to: '/appointments', label: 'Appointments', icon: '📅', module: MODULES.APPOINTMENTS, phase: 2 },
      { to: '/admissions', label: 'Admissions', icon: '🛏️', module: MODULES.BEDS, phase: 4 },
    ],
  },
  {
    heading: 'Diagnostics',
    items: [
      { to: '/lab', label: 'Laboratory', icon: '🧪', module: MODULES.LAB_ORDERS },
      { to: '/radiology', label: 'Radiology', icon: '🩻', module: MODULES.RADIOLOGY_ORDERS, phase: 7 },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { to: '/pharmacy', label: 'Pharmacy', icon: '💊', module: MODULES.PRESCRIPTIONS, phase: 8 },
      { to: '/inventory', label: 'Inventory', icon: '📦', module: MODULES.INVENTORY, phase: 9 },
      { to: '/billing', label: 'Billing', icon: '🧾', module: MODULES.BILLING, phase: 10 },
      { to: '/insurance', label: 'Insurance', icon: '🛡️', module: MODULES.CLAIMS, phase: 11 },
      { to: '/hr', label: 'HR & Payroll', icon: '👥', module: MODULES.PAYROLL, phase: 12 },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { to: '/departments', label: 'Departments', icon: '🏢', module: MODULES.DEPARTMENTS },
      { to: '/wards', label: 'Wards & Beds', icon: '🏥', module: MODULES.WARDS },
      { to: '/staff', label: 'Staff Accounts', icon: '🔑', module: MODULES.STAFF, phase: 5 },
      { to: '/audit', label: 'Audit Log', icon: '📜', module: MODULES.AUDIT_LOGS, phase: 14 },
    ],
  },
];

function NavItem({ item }) {
  const base =
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors';

  if (item.phase) {
    return (
      <span
        className={`${base} cursor-not-allowed text-slate-400`}
        title={`Arrives in Phase ${item.phase}`}
      >
        <span aria-hidden="true">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
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
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        ].join(' ')
      }
    >
      <span aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar({ open, onClose }) {
  const { canAccess } = useAuth();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    // No `module` means the item is available to anyone signed in (Dashboard).
    items: section.items.filter((item) => !item.module || canAccess(item.module)),
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

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
          <span className="text-xl" aria-hidden="true">
            🏥
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">HMS</p>
            <p className="truncate text-xs text-slate-500">Hospital Management</p>
          </div>
        </div>

        <nav className="h-[calc(100vh-4rem)] space-y-6 overflow-y-auto p-3">
          {sections.map((section) => (
            <div key={section.heading ?? 'root'}>
              {section.heading && (
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.heading}
                </p>
              )}
              <div className="space-y-0.5" onClick={onClose}>
                {section.items.map((item) => (
                  <NavItem key={item.to} item={item} />
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
