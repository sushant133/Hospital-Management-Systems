import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  triageApi, ESI_OPTIONS, ESI_TONES, TRIAGE_STATUS_TONES,
} from '../../../api/triageApi.js';
import { patientsApi } from '../../../api/patientApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, Input, Modal, PageHeader, Select,
  Spinner, Textarea,
} from '../../../components/ui/index.js';

const EMPTY = {
  patientId: '', chiefComplaint: '', esi: 3, mechanism: '', notes: '',
  assignedTo: '', isTrauma: false, airway: '', breathing: '', circulation: '',
  disability: '', exposure: '', pulseBpm: '', systolicBp: '', spo2: '', gcs: '',
};

export function EmergencyPage() {
  const { can } = useAuth();
  const canCreate = can(MODULES.TRIAGE, 'create');
  const canAssign = can(MODULES.TRIAGE, 'assign');
  const canEdit = can(MODULES.TRIAGE, 'edit');

  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await triageApi.list({ waitingOnly: true, limit: 100, sort: 'esi,arrivedAt' });
      setBoard(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

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
      } catch { /* optional */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    if (!form.patientId) return setFormError('Choose a patient.');
    if (!form.chiefComplaint.trim()) return setFormError('Record the chief complaint.');
    setSaving(true);
    setFormError(null);
    try {
      const response = await triageApi.create({
        patientId: form.patientId,
        chiefComplaint: form.chiefComplaint.trim(),
        esi: Number(form.esi),
        mechanism: form.mechanism,
        notes: form.notes,
        assignedTo: form.assignedTo || null,
        openEncounter: true,
        vitals: {
          pulseBpm: form.pulseBpm ? Number(form.pulseBpm) : undefined,
          systolicBp: form.systolicBp ? Number(form.systolicBp) : undefined,
          spo2: form.spo2 ? Number(form.spo2) : undefined,
          gcs: form.gcs ? Number(form.gcs) : undefined,
        },
        trauma: {
          isTrauma: form.isTrauma,
          airway: form.airway,
          breathing: form.breathing,
          circulation: form.circulation,
          disability: form.disability,
          exposure: form.exposure,
        },
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

  const dispose = async (row, status) => {
    try {
      const response = await triageApi.dispose(row._id, { status });
      setNotice(response.message);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const assign = async (row, assignedTo) => {
    try {
      const response = await triageApi.assign(row._id, { assignedTo });
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const columns = [1, 2, 3, 4, 5].map((esi) => ({
    esi,
    rows: board.filter((row) => row.esi === esi),
  }));

  return (
    <div>
      <PageHeader
        title="Emergency triage"
        description="ESI waiting board. Level 1 is immediately life-threatening."
        action={canCreate && (
          <Button onClick={() => { setForm(EMPTY); setFormError(null); setOpen(true); }}>
            New assessment
          </Button>
        )}
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {loading ? <Spinner label="Loading board…" className="py-12" /> : (
        <div className="grid gap-3 lg:grid-cols-5">
          {columns.map((col) => (
            <div key={col.esi} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <Badge tone={ESI_TONES[col.esi]}>ESI {col.esi}</Badge>
                <span className="text-xs text-slate-400">{col.rows.length}</span>
              </div>
              <div className="space-y-2">
                {col.rows.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-slate-400">Empty</p>
                )}
                {col.rows.map((row) => (
                  <button
                    key={row._id}
                    type="button"
                    onClick={() => setSelected(row)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-brand-300"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-brand-600">{row.triageNumber}</span>
                      <Badge tone={TRIAGE_STATUS_TONES[row.status]}>{row.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-900">{fullName(row.patientId)}</p>
                    <p className="line-clamp-2 text-xs text-slate-500">{row.chiefComplaint}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {row.waitMinutes ?? 0} min · {formatDate(row.arrivedAt, { withTime: true })}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.triageNumber} · ESI ${selected.esi}` : ''}
        description={selected ? fullName(selected.patientId) : ''}
        footer={
          selected && canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => dispose(selected, 'discharged')}>Discharge</Button>
              <Button variant="secondary" onClick={() => dispose(selected, 'admitted')}>Admit</Button>
              <Button variant="secondary" onClick={() => dispose(selected, 'lwbs')}>LWBS</Button>
              <Button variant="secondary" onClick={() => dispose(selected, 'transferred')}>Transfer</Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <p>{selected.chiefComplaint}</p>
            {selected.encounterId?._id && (
              <Link to={`/encounters/${selected.encounterId._id}`} className="text-brand-600">
                Open visit {selected.encounterId.encounterNumber}
              </Link>
            )}
            {selected.trauma?.isTrauma && (
              <Card>
                <CardHeader title="Trauma ABCDE" />
                {['airway', 'breathing', 'circulation', 'disability', 'exposure'].map((k) => (
                  <p key={k}><span className="font-medium capitalize">{k}:</span> {selected.trauma[k] || '—'}</p>
                ))}
              </Card>
            )}
            {canAssign && (
              <Select
                label="Assign clinician"
                value={selected.assignedTo?._id ?? ''}
                onChange={(e) => e.target.value && assign(selected, e.target.value)}
              >
                <option value="">Unassigned</option>
                {doctors.map((d) => <option key={d._id} value={d._id}>{fullName(d)}</option>)}
              </Select>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New triage assessment"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={submit}>Record</Button>
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
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      onClick={() => {
                        setForm((prev) => ({ ...prev, patientId: p._id }));
                        setPatientSearch(`${fullName(p)} (${p.mrn})`);
                        setPatientResults([]);
                      }}
                    >
                      {fullName(p)} <span className="font-mono text-xs text-slate-400">{p.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Select label="ESI" value={form.esi} onChange={set('esi')}>
            {ESI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select label="Assign" value={form.assignedTo} onChange={set('assignedTo')}>
            <option value="">Later</option>
            {doctors.map((d) => <option key={d._id} value={d._id}>{fullName(d)}</option>)}
          </Select>
          <Textarea className="sm:col-span-2" label="Chief complaint" rows={2} value={form.chiefComplaint} onChange={set('chiefComplaint')} />
          <Input label="Pulse" value={form.pulseBpm} onChange={set('pulseBpm')} />
          <Input label="SBP" value={form.systolicBp} onChange={set('systolicBp')} />
          <Input label="SpO₂" value={form.spo2} onChange={set('spo2')} />
          <Input label="GCS" value={form.gcs} onChange={set('gcs')} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.isTrauma} onChange={set('isTrauma')} />
            Trauma — record ABCDE
          </label>
          {form.isTrauma && (
            <>
              <Input label="Airway" value={form.airway} onChange={set('airway')} />
              <Input label="Breathing" value={form.breathing} onChange={set('breathing')} />
              <Input label="Circulation" value={form.circulation} onChange={set('circulation')} />
              <Input label="Disability" value={form.disability} onChange={set('disability')} />
              <Input className="sm:col-span-2" label="Exposure" value={form.exposure} onChange={set('exposure')} />
            </>
          )}
          <Textarea className="sm:col-span-2" label="Notes" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
      </Modal>
    </div>
  );
}

export default EmergencyPage;
