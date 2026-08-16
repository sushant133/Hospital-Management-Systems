import { useCallback, useEffect, useState } from 'react';
import { emarApi, MAR_STATUS_OPTIONS, MAR_STATUS_TONES } from '../../../api/emarApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Select, Spinner, Textarea,
} from '../../../components/ui/index.js';

/**
 * The eMAR: what was actually given (or held/refused), which is not the
 * same as what pharmacy dispensed.
 */
export function EmarPanel({ encounterId, prescriptions = [], canChart, closed }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ prescriptionId: '', prescriptionItemId: '', status: 'given', reason: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await emarApi.list({ encounterId, limit: 100 });
      setRows(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedRx = prescriptions.find((rx) => rx._id === form.prescriptionId);
  const items = selectedRx?.items ?? [];

  const chart = async () => {
    if (!form.prescriptionId || !form.prescriptionItemId) {
      return setError('Choose a prescription item.');
    }
    if (form.status !== 'given' && !form.reason.trim()) {
      return setError('Give a reason when holding, refusing or missing a dose.');
    }
    setSaving(true);
    setError(null);
    try {
      const response = await emarApi.record({
        prescriptionId: form.prescriptionId,
        prescriptionItemId: form.prescriptionItemId,
        status: form.status,
        reason: form.reason.trim() || undefined,
      });
      setNotice(response.message);
      setForm((prev) => ({ ...prev, reason: '' }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-5">
      <CardHeader
        title="Medication administration (eMAR)"
        description="Chart what was given, held or refused on this visit."
      />

      {notice && (
        <Alert tone="success" className="mb-3" onDismiss={() => setNotice(null)}>{notice}</Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>{error}</Alert>
      )}

      {canChart && !closed && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Select
            label="Prescription"
            value={form.prescriptionId}
            onChange={(e) => setForm((p) => ({ ...p, prescriptionId: e.target.value, prescriptionItemId: '' }))}
          >
            <option value="">Select…</option>
            {prescriptions.filter((rx) => rx.status !== 'cancelled').map((rx) => (
              <option key={rx._id} value={rx._id}>{rx.prescriptionNumber}</option>
            ))}
          </Select>
          <Select
            label="Item"
            value={form.prescriptionItemId}
            onChange={(e) => setForm((p) => ({ ...p, prescriptionItemId: e.target.value }))}
          >
            <option value="">Select…</option>
            {items.map((item) => (
              <option key={item._id} value={item._id}>{item.drugName} {item.dosage}</option>
            ))}
          </Select>
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
          >
            {MAR_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button loading={saving} onClick={chart}>Chart dose</Button>
          </div>
          <div className="sm:col-span-4">
            <Textarea
              label="Reason / notes"
              rows={2}
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Required when held, refused or missed. Also used as an allergy override."
            />
          </div>
        </div>
      )}

      {loading ? (
        <Spinner label="Loading administrations…" className="py-6" />
      ) : rows.length === 0 ? (
        <EmptyState icon="📋" title="Nothing charted" description="Doses given on this visit appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row._id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-medium text-slate-900">{row.drugName}</span>
                <span className="ml-2 text-slate-500">{row.dose} · {row.route}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {fullName(row.administeredBy)} · {formatDate(row.administeredAt, { withTime: true })}
                </span>
              </div>
              <Badge tone={MAR_STATUS_TONES[row.status] ?? 'neutral'}>{row.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default EmarPanel;
