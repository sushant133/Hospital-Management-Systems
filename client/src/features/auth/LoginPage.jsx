import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Alert, Button, Input, Spinner } from '../../components/ui/index.js';

export function LoginPage() {
  const { login, isAuthenticated, bootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;
  }

  const update = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Cheap client-side check; the server validates authoritatively.
    const errors = {};
    if (!form.email.trim()) errors.email = 'Email is required';
    if (!form.password) errors.password = 'Password is required';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (error) {
      setFieldErrors(error.fieldErrors ?? {});
      // Field-level messages already explain a validation failure.
      if (!Object.keys(error.fieldErrors ?? {}).length) {
        setFormError(error.message || 'Unable to sign in. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

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

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {formError && <Alert tone="error">{formError}</Alert>}

            <Input
              label="Email"
              type="email"
              name="email"
              autoComplete="username"
              placeholder="you@hospital.local"
              value={form.email}
              onChange={update('email')}
              error={fieldErrors.email}
              required
              autoFocus
            />

            <Input
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={form.password}
              onChange={update('password')}
              error={fieldErrors.password}
              required
            />

            <Button type="submit" loading={submitting} className="w-full" size="lg">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Authorized personnel only. All activity is logged.
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
