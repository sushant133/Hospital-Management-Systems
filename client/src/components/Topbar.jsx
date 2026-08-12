import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../app/AuthContext.jsx';
import { ROLE_LABELS } from '../app/roles.js';
import { fullName, initials } from '../lib/format.js';

export function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M3 5.75A.75.75 0 013.75 5h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.75zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <div className="hidden lg:block" />

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-100"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {initials(user)}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-sm font-medium text-slate-900">{fullName(user)}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user?.role] ?? user?.role}</p>
          </div>
          <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="truncate text-sm font-medium text-slate-900">{fullName(user)}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
              {user?.employeeId && (
                <p className="mt-1 text-xs text-slate-400">{user.employeeId}</p>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Topbar;
