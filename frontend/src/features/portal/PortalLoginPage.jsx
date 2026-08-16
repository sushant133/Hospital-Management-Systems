import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { portalApi } from '../../api/tier23Api.js';
import { Alert, Button, Input } from '../../components/ui/index.js';

export function PortalLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portalApi.login({ email, password });
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Patient portal</p>
          <h1 className="text-lg font-semibold text-slate-900">Sign in to your records</h1>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit" loading={busy} className="w-full">Sign in</Button>
        <p className="text-center text-xs text-slate-500">
          Staff? <Link to="/login" className="text-brand-600">Hospital sign-in</Link>
        </p>
      </form>
    </div>
  );
}

export default PortalLoginPage;
