import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { theatreApi, SURGERY_STATUS_TONES, PRIORITY_TONES } from '../../../api/theatreApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, DataRow, Input, PageHeader, Select,
  Spinner, Textarea,
} from '../../../components/ui/index.js';

const SIGN_IN = [
  ['identityConfirmed', 'Identity confirmed'],
  ['siteMarked', 'Site marked'],
  ['consentConfirmed', 'Consent confirmed'],
  ['allergiesReviewed', 'Allergies reviewed'],
  ['pulseOximeterOn', 'Pulse oximeter on'],
];
const TIME_OUT = [
  ['teamIntroduced', 'Team introduced'],
  ['procedureConfirmed', 'Procedure confirmed'],
  ['antibioticGiven', 'Antibiotic given'],
  ['imagingDisplayed', 'Imaging displayed'],
];
const SIGN_OUT = [
  ['procedureRecorded', 'Procedure recorded'],
  ['countsCorrect', 'Counts correct'],
  ['specimensLabelled', 'Specimens labelled'],
  ['equipmentProblemsNoted', 'Equipment problems noted'],
];

function ChecklistBlock({ title, items, values, onToggle, disabled }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2">
        {items.map(([key, label]) => {
          const tick = values?.[key];
          return (
            <li key={key}>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(tick?.checked)}
                  disabled={disabled}
                  onChange={(e) => onToggle(key, e.target.checked)}
                />
                {label}
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function SurgeryDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const canEdit = can(MODULES.THEATRE, 'edit');
  const canStart = can(MODULES.THEATRE, 'start');
  const canComplete = can(MODULES.THEATRE, 'complete');
  const canCancel = can(MODULES.THEATRE, 'cancel');

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [implant, setImplant] = useState({ name: '', catalogueNo: '', lotNo: '', site: '' });
  const [anaesthesia, setAnaesthesia] = useState({ type: '', asaClass: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await theatreApi.get(id);
      setRow(data);
      setFindings(data.findings ?? '');
      setAnaesthesia({
        type: data.anaesthesia?.type ?? '',
        asaClass: data.anaesthesia?.asaClass ?? '',
        notes: data.anaesthesia?.notes ?? '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const closed = row && ['completed', 'cancelled'].includes(row.status);

  const toggle = (block, key, checked) => {
    setRow((prev) => {
      const next = structuredClone(prev);
      next.whoChecklist = next.whoChecklist ?? {};
      next.whoChecklist[block] = next.whoChecklist[block] ?? {};
      next.whoChecklist[block][key] = {
        checked,
        checkedAt: checked ? new Date().toISOString() : null,
        checkedBy: checked ? user?._id : null,
      };
      return next;
    });
  };

  const saveChecklist = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await theatreApi.update(id, {
        whoChecklist: row.whoChecklist,
        anaesthesia,
        findings,
        implants: row.implants ?? [],
      });
      setNotice(response.message);
      setRow(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, payload) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fn(id, payload);
      setNotice(response.message);
      setRow(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addImplant = () => {
    if (!implant.name.trim()) return;
    setRow((prev) => ({ ...prev, implants: [...(prev.implants ?? []), { ...implant }] }));
    setImplant({ name: '', catalogueNo: '', lotNo: '', site: '' });
  };

  if (loading) return <Spinner label="Loading case…" className="py-16" />;
  if (!row) return <Alert tone="error">{error || 'Case not found'}</Alert>;

  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/theatre" className="hover:text-slate-700">← Theatre</Link>}
        title={
          <span className="flex items-center gap-3">
            {row.surgeryNumber}
            <Badge tone={SURGERY_STATUS_TONES[row.status]}>{row.status}</Badge>
            <Badge tone={PRIORITY_TONES[row.priority]}>{row.priority}</Badge>
          </span>
        }
        description={`${row.procedure} · ${row.theatre}`}
        action={
          <div className="flex flex-wrap gap-2">
            {row.status === 'scheduled' && canStart && (
              <Button loading={busy} onClick={() => act(theatreApi.start)}>Start</Button>
            )}
            {['in-theatre', 'recovery'].includes(row.status) && canComplete && (
              <Button loading={busy} onClick={() => act(theatreApi.complete, { findings })}>
                {row.status === 'in-theatre' ? 'To recovery' : 'Complete'}
              </Button>
            )}
            {row.status === 'scheduled' && canCancel && (
              <Button
                variant="danger"
                loading={busy}
                onClick={() => {
                  if (cancelReason.trim().length < 5) return setError('Give a cancellation reason.');
                  return act(theatreApi.cancel, { reason: cancelReason });
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader title="Patient" />
          <DataRow label="Name" value={fullName(row.patientId)} />
          <DataRow label="MRN" value={row.patientId?.mrn} />
          <DataRow
            label="Visit"
            value={
              row.encounterId?._id ? (
                <Link to={`/encounters/${row.encounterId._id}`} className="text-brand-600">
                  {row.encounterId.encounterNumber}
                </Link>
              ) : '—'
            }
          />
        </Card>
        <Card>
          <CardHeader title="Team" />
          <DataRow label="Surgeon" value={row.surgeonId ? fullName(row.surgeonId) : '—'} />
          <DataRow label="Anaesthetist" value={row.anaesthetistId ? fullName(row.anaesthetistId) : '—'} />
          <DataRow label="Window" value={formatDate(row.scheduledStart, { withTime: true })} />
        </Card>
        <Card>
          <CardHeader title="Cancel / findings" />
          {row.status === 'scheduled' && (
            <Textarea label="Cancel reason" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          )}
          <Textarea className="mt-2" label="Findings" rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} disabled={!canEdit || closed} />
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-700">WHO surgical safety checklist</h2>
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <ChecklistBlock title="Sign-in" items={SIGN_IN} values={row.whoChecklist?.signIn} disabled={!canEdit || closed} onToggle={(k, v) => toggle('signIn', k, v)} />
        <ChecklistBlock title="Time-out" items={TIME_OUT} values={row.whoChecklist?.timeOut} disabled={!canEdit || closed} onToggle={(k, v) => toggle('timeOut', k, v)} />
        <ChecklistBlock title="Sign-out" items={SIGN_OUT} values={row.whoChecklist?.signOut} disabled={!canEdit || closed} onToggle={(k, v) => toggle('signOut', k, v)} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Anaesthesia" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Type" value={anaesthesia.type} disabled={!canEdit || closed} onChange={(e) => setAnaesthesia((p) => ({ ...p, type: e.target.value }))}>
              <option value="">—</option>
              {['ga', 'spinal', 'epidural', 'regional', 'local', 'sedation'].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </Select>
            <Select label="ASA" value={anaesthesia.asaClass} disabled={!canEdit || closed} onChange={(e) => setAnaesthesia((p) => ({ ...p, asaClass: e.target.value }))}>
              <option value="">—</option>
              {['I', 'II', 'III', 'IV', 'V'].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Textarea className="sm:col-span-2" label="Notes" rows={2} value={anaesthesia.notes} disabled={!canEdit || closed} onChange={(e) => setAnaesthesia((p) => ({ ...p, notes: e.target.value }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Implants" />
          <ul className="mb-3 space-y-1 text-sm">
            {(row.implants ?? []).length === 0 && <li className="text-slate-400">None recorded.</li>}
            {(row.implants ?? []).map((item, index) => (
              <li key={item._id ?? index}>
                <strong>{item.name}</strong>
                {item.lotNo ? ` · lot ${item.lotNo}` : ''}
                {item.site ? ` · ${item.site}` : ''}
              </li>
            ))}
          </ul>
          {canEdit && !closed && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="Name" value={implant.name} onChange={(e) => setImplant((p) => ({ ...p, name: e.target.value }))} />
              <Input label="Lot" value={implant.lotNo} onChange={(e) => setImplant((p) => ({ ...p, lotNo: e.target.value }))} />
              <Input label="Catalogue" value={implant.catalogueNo} onChange={(e) => setImplant((p) => ({ ...p, catalogueNo: e.target.value }))} />
              <Input label="Site" value={implant.site} onChange={(e) => setImplant((p) => ({ ...p, site: e.target.value }))} />
              <Button variant="secondary" onClick={addImplant}>Add implant</Button>
            </div>
          )}
        </Card>
      </div>

      {canEdit && !closed && (
        <Button loading={busy} onClick={saveChecklist}>Save checklist, anaesthesia and implants</Button>
      )}
    </div>
  );
}

export default SurgeryDetailPage;
