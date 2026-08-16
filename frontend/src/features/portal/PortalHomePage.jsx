import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { portalApi } from '../../api/tier23Api.js';
import { formatDate, fullName } from '../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, Input, PageHeader, Select, Spinner,
} from '../../components/ui/index.js';

export function PortalHomePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [results, setResults] = useState({ lab: [], radiology: [] });
  const [invoices, setInvoices] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState({ doctorId: '', departmentId: '', date: '', time: '09:00' });
  const [slots, setSlots] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, appt, res, inv, docs] = await Promise.all([
        portalApi.me(),
        portalApi.appointments(),
        portalApi.results(),
        portalApi.invoices(),
        portalApi.doctors().catch(() => ({ data: [] })),
      ]);
      setMe(meRes.data);
      setAppointments(appt.data);
      setResults(res.data);
      setInvoices(inv.data);
      setDoctors(docs.data ?? []);
    } catch (err) {
      if (err.status === 401) {
        navigate('/portal/login', { replace: true });
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!book.doctorId || !book.date) {
      setSlots([]);
      return undefined;
    }
    let cancelled = false;
    portalApi.slots({ doctorId: book.doctorId, date: book.date }).then((res) => {
      if (!cancelled) setSlots(res.data ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [book.doctorId, book.date]);

  const submitBook = async () => {
    const slot = slots.find((s) => s.available && (s.time === book.time || s.start === book.time));
    const start = slot?.start || (book.date && book.time ? `${book.date}T${book.time}:00` : null);
    if (!start || !book.doctorId) return setError('Choose a doctor and a free slot.');
    const doctor = doctors.find((d) => d._id === book.doctorId);
    const end = slot?.end || new Date(new Date(start).getTime() + 15 * 60000).toISOString();
    setSaving(true);
    setError(null);
    try {
      const response = await portalApi.book({
        doctorId: book.doctorId,
        departmentId: doctor?.departmentId?._id ?? doctor?.departmentId,
        scheduledStart: start,
        scheduledEnd: end,
        reason: 'Portal self-book',
      });
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await portalApi.logout().catch(() => {});
    navigate('/portal/login', { replace: true });
  };

  if (loading) return <Spinner label="Loading your record…" className="py-20" />;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title={me ? `Hello, ${me.patient.firstName}` : 'Patient portal'}
        description={me ? `${me.patient.mrn}` : ''}
        action={<Button variant="secondary" onClick={logout}>Sign out</Button>}
      />
      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Book an appointment" />
          <div className="grid gap-3">
            <Select label="Doctor" value={book.doctorId} onChange={(e) => setBook((p) => ({ ...p, doctorId: e.target.value }))}>
              <option value="">Choose…</option>
              {doctors.map((d) => <option key={d._id} value={d._id}>{fullName(d)}</option>)}
            </Select>
            <Input label="Date" type="date" value={book.date} onChange={(e) => setBook((p) => ({ ...p, date: e.target.value }))} />
            <Select label="Slot" value={book.time} onChange={(e) => setBook((p) => ({ ...p, time: e.target.value }))}>
              <option value="">Choose…</option>
              {slots.filter((s) => s.available).map((s) => (
                <option key={s.start} value={s.start}>{s.time}</option>
              ))}
            </Select>
            <Button loading={saving} onClick={submitBook}>Request booking</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="My appointments" />
          <ul className="space-y-2 text-sm">
            {appointments.length === 0 && <li className="text-slate-400">None yet.</li>}
            {appointments.map((a) => (
              <li key={a._id} className="flex justify-between">
                <span>{formatDate(a.scheduledStart, { withTime: true })} · {fullName(a.doctorId)}</span>
                <Badge>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Results" />
          <ul className="space-y-1 text-sm">
            {(results.lab ?? []).map((o) => (
              <li key={o._id}>{o.orderNumber} · lab · {formatDate(o.completedAt)}</li>
            ))}
            {(results.radiology ?? []).map((o) => (
              <li key={o._id}>{o.orderNumber} · imaging · {formatDate(o.completedAt)}</li>
            ))}
            {!results.lab?.length && !results.radiology?.length && <li className="text-slate-400">No completed reports.</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Bills" />
          <ul className="space-y-1 text-sm">
            {invoices.length === 0 && <li className="text-slate-400">None.</li>}
            {invoices.map((inv) => (
              <li key={inv._id} className="flex justify-between">
                <span>{inv.invoiceNumber}</span>
                <span>{inv.total} · {inv.status} · bal {inv.balance}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-6 text-center text-xs text-slate-400">
        <Link to="/login" className="text-brand-600">Staff sign-in</Link>
      </p>
    </div>
  );
}

export default PortalHomePage;
