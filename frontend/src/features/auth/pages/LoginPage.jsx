import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth.js';
import { Alert, Button, Input, Spinner } from '../../../components/ui/index.js';

/** Matches backend/.env SEED_ADMIN_* — only shown/prefilled in Vite dev. */
const DEV_SEED = import.meta.env.DEV
  ? { email: 'admin@hospital.local', password: 'Admin@12345' }
  : null;

export function LoginPage() {
  const { login, isAuthenticated, bootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({
    email: DEV_SEED?.email ?? '',
    password: DEV_SEED?.password ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(Boolean(DEV_SEED));

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

  // The centred frame and branding come from <AuthLayout/>.
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
        autoComplete={DEV_SEED ? 'off' : 'on'}
      >
        {formError && <Alert tone="error">{formError}</Alert>}

        {DEV_SEED && (
          <Alert tone="info" title="Development seed account">
            <p>
              Email <span className="font-mono">{DEV_SEED.email}</span>
            </p>
            <p>
              Password <span className="font-mono">{DEV_SEED.password}</span>
            </p>
            <p className="mt-1 text-xs opacity-80">
              Capital A, then <span className="font-mono">dmin@12345</span>. If the browser
              autofills a different password, replace it or click Fill seed account.
            </p>
            <button
              type="button"
              className="mt-2 text-xs font-medium underline underline-offset-2"
              onClick={() => {
                setForm({ ...DEV_SEED });
                setFormError(null);
                setFieldErrors({});
              }}
            >
              Fill seed account
            </button>
          </Alert>
        )}

        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete={DEV_SEED ? 'off' : 'username'}
          placeholder="you@hospital.local"
          value={form.email}
          onChange={update('email')}
          error={fieldErrors.email}
          required
          autoFocus={!DEV_SEED}
        />

        <div>
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete={DEV_SEED ? 'off' : 'current-password'}
            placeholder="••••••••"
            value={form.password}
            onChange={update('password')}
            error={fieldErrors.password}
            required
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            Show password
          </label>
        </div>

        <Button type="submit" loading={submitting} className="w-full" size="lg">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-xs text-slate-500">
          Patient? <a href="/portal/login" className="text-brand-600">Open the portal</a>
        </p>
      </form>
    </div>
  );
}

export default LoginPage;
