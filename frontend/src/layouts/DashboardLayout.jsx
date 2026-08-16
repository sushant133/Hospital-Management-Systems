import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { Alert } from '../components/ui/index.js';

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 p-4 sm:p-6">
          {user?.mustChangePassword && (
            <Alert tone="warning" title="Change your password" className="mb-6">
              You are still using a password that was set for you. Change it from your profile as
              soon as possible.
            </Alert>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default DashboardLayout;
