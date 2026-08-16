import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  theatreApi,
  THEATRE_ROOMS,
  SURGERY_STATUS_OPTIONS,
  SURGERY_STATUS_TONES,
  PRIORITY_TONES,
} from '../../../api/theatreApi.js';
import { patientsApi } from '../../../api/patientApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'case', label: 'Case' },
  { key: 'patient', label: 'Patient' },
  { key: 'theatre', label: 'Theatre' },
  { key: 'when', label: 'Scheduled' },
  { key: 'surgeon', label: 'Surgeon' },
  { key: 'status', label: 'Status' },
];

const EMPTY = {
  patientId: '', encounterId: '', theatre: 'OT-1', procedure: '', diagnosis: '',
  laterality: 'n/a', priority: 'elective', scheduledStart: '', scheduledEnd: '',
  surgeonId: '', anaesthetistId: '', price: '0', notes: '',
};

export function TheatrePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canCreate = can(MODULES.THEATRE, 'create');

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [theatre, setTheatre] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [visits, setVisits] = useState([]);
  const [doctors, setDoctors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await theatreApi.list({
        status: status || undefined,
        theatre: theatre || undefined,
        limit: 100,
      });
      setRows(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, theatre]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    staffApi.doctors({ limit: 50 }).then((res) => setDoctors(res.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const term = patientSearch.trim();
    if (term.length < 2) {
      setPatientResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await patientsApi.list({ search: term, limit: 8 });
        setPatientResults(response.data);
      } catch { /* lookup is optional */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  const pickPatient = async (patient) => {
    setForm((p) => ({ ...p, patientId: patient._id, encounterId: '' }));
    setPatientSearch(`${fullName(patient)} (${patient.mrn})`);
    setPatientResults([]);
    try {
      const response = await patientsApi.encounters(patient._id, { limit: 20 });
      setVisits((response.data ?? []).filter((v) => !['cancelled'].includes(v.status)));
    } catch {
      setVisits([]);
    }
  };

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const book = async () => {
    setFormError(null);
    if (!form.patientId || !form.encounterId) return setFormError('Choose a patient and visit.');
    if (!form.procedure.trim()) return setFormError('Name the procedure.');
    if (!form.scheduledStart || !form.scheduledEnd) return setFormError('Give the scheduled window.');
    if (!form.surgeonId) return setFormError('Choose a surgeon.');
    setSaving(true);
    try {
      const response = await theatreApi.create({
        ...form,
        price: Number(form.price || 0),
        scheduledStart: new Date(form.scheduledStart).toISOString(),
        scheduledEnd: new Date(form.scheduledEnd).toISOString(),
        anaesthetistId: form.anaesthetistId || null,
      });
      setNotice(response.message);
      setOpen(false);
      setForm(EMPTY);
      setPatientSearch('');
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Theatre"
        description="Booked cases, WHO checklist and implant log."
        action={canCreate && <Button onClick={() => { setForm(EMPTY); setFormError(null); setOpen(true); }}>Book a case</Button>}
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={theatre} onChange={(e) => setTheatre(e.target.value)}>
          <option value="">All theatres</option>
          {THEATRE_ROOMS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {SURGERY_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {loading ? <Spinner label="Loading list…" className="py-12" /> : (
        <Table>
          <THead columns={COLUMNS} />
          <TBody>
            {rows.length === 0 && <TRMessage colSpan={COLUMNS.length}>No cases in this filter.</TRMessage>}
            {rows.map((row) => (
              <TR key={row._id} onClick={() => navigate(`/theatre/${row._id}`)}>
                <TD>
                  <Link to={`/theatre/${row._id}`} className="font-mono text-xs font-medium text-brand-600">
                    {row.surgeryNumber}
                  </Link>
                  <div className="text-sm text-slate-900">{row.procedure}</div>
                </TD>
                <TD>
                  {fullName(row.patientId)}
                  <div className="font-mono text-xs text-slate-400">{row.patientId?.mrn}</div>
                </TD>
                <TD>
                  {row.theatre}
                  <Badge tone={PRIORITY_TONES[row.priority] ?? 'neutral'} className="ml-2">{row.priority}</Badge>
                </TD>
                <TD className="whitespace-nowrap text-xs">
                  {formatDate(row.scheduledStart, { withTime: true })}
                </TD>
                <TD>{row.surgeonId ? fullName(row.surgeonId) : '—'}</TD>
                <TD><Badge tone={SURGERY_STATUS_TONES[row.status] ?? 'neutral'}>{row.status}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Book a theatre case"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={book}>Book</Button>
          </>
        }
      >
        {formError && <Alert tone="error" className="mb-3">{formError}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Patient" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search name or MRN" />
            {patientResults.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-y-auto rounded border border-slate-200">
                {patientResults.map((p) => (
                  <li key={p._id}>
                    <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => pickPatient(p)}>
                      {fullName(p)} <span className="font-mono text-xs text-slate-400">{p.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Select label="Visit" value={form.encounterId} onChange={set('encounterId')}>
            <option value="">Select visit…</option>
            {visits.map((v) => (
              <option key={v._id} value={v._id}>{v.encounterNumber} · {v.type} · {v.status}</option>
            ))}
          </Select>
          <Select label="Theatre" value={form.theatre} onChange={set('theatre')}>
            {THEATRE_ROOMS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Input label="Procedure" value={form.procedure} onChange={set('procedure')} className="sm:col-span-2" />
          <Input label="Diagnosis" value={form.diagnosis} onChange={set('diagnosis')} />
          <Select label="Priority" value={form.priority} onChange={set('priority')}>
            <option value="elective">Elective</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </Select>
          <Input label="Start" type="datetime-local" value={form.scheduledStart} onChange={set('scheduledStart')} />
          <Input label="End" type="datetime-local" value={form.scheduledEnd} onChange={set('scheduledEnd')} />
          <Select label="Surgeon" value={form.surgeonId} onChange={set('surgeonId')}>
            <option value="">Select…</option>
            {doctors.map((d) => <option key={d._id} value={d._id}>{fullName(d)}</option>)}
          </Select>
          <Select label="Anaesthetist" value={form.anaesthetistId} onChange={set('anaesthetistId')}>
            <option value="">None</option>
            {doctors.map((d) => <option key={d._id} value={d._id}>{fullName(d)}</option>)}
          </Select>
          <Input label="Price" type="number" min="0" value={form.price} onChange={set('price')} />
          <Select label="Laterality" value={form.laterality} onChange={set('laterality')}>
            <option value="n/a">n/a</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="bilateral">Bilateral</option>
          </Select>
          <Textarea className="sm:col-span-2" label="Notes" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
      </Modal>
    </div>
  );
}

export default TheatrePage;
