import { Outlet } from 'react-router-dom';

/**
 * Shell for the unauthenticated pages (sign-in, and later password reset).
 *
 * Owns the centred frame and the branding so each auth page only renders its
 * own card.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-3 text-4xl" aria-hidden="true">
            🏥
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Hospital Management System</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>

        <Outlet />

        <p className="mt-6 text-center text-xs text-slate-400">
          Authorized personnel only. All activity is logged.
        </p>
      </div>
    </div>
  );
}

export default AuthLayout;
