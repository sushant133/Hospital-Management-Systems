import { useMemo, useState } from 'react';
import {
  ehrApi,
  VITAL_FIELDS,
  VITAL_FLAG_TONES,
  VITAL_FLAG_LABELS,
} from '../../../api/ehrApi.js';
import { Alert, Badge, Button, Card, CardHeader, Textarea } from '../../../components/ui/index.js';

const EMPTY = Object.fromEntries(VITAL_FIELDS.map((field) => [field.key, '']));

/**
 * Record one set of observations.
 *
 * Flags are computed by the server and echoed back — the form previews nothing
 * itself, so the chart and the API can never disagree about what counts as
 * abnormal. (The lab's result entry previews flags client-side because it
 * checks against per-test ranges it already holds; vitals ranges live only on
 * the server.)
 */
export function VitalsForm({ encounterId, disabled, onRecorded }) {
  const [form, setForm] = useState(EMPTY);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lastRecorded, setLastRecorded] = useState(null);

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setError(null);
  };

  const filled = useMemo(
    () => VITAL_FIELDS.filter((field) => String(form[field.key]).trim() !== ''),
    [form],
  );

  const submit = async () => {
    setError(null);

    if (filled.length === 0) {
      return setError('Record at least one measurement.');
    }

    const payload = {};
    for (const field of filled) payload[field.key] = Number(form[field.key]);
    if (notes.trim()) payload.notes = notes.trim();

    setSaving(true);
    try {
      const response = await ehrApi.recordVitals(encounterId, payload);
      setLastRecorded(response.data);
      setForm(EMPTY);
      setNotes('');
      onRecorded?.(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Record observations"
        description="Each set is kept — recording again adds to the series rather than replacing it."
      />

      {disabled ? (
        <Alert tone="neutral">This visit is closed; observations can no longer be added.</Alert>
      ) : (
        <>
          {error && (
            <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {lastRecorded && (
            <Alert
              tone={lastRecorded.hasCritical ? 'error' : lastRecorded.hasAbnormal ? 'warning' : 'success'}
              className="mb-3"
              title={
                lastRecorded.hasCritical
                  ? 'Recorded — readings outside critical thresholds'
                  : lastRecorded.hasAbnormal
                    ? 'Recorded — some readings outside the usual range'
                    : 'Recorded'
              }
              onDismiss={() => setLastRecorded(null)}
            >
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(lastRecorded.flags ?? {})
                  .filter(([, flag]) => flag !== 'normal')
                  .map(([field, flag]) => (
                    <Badge key={field} tone={VITAL_FLAG_TONES[flag] ?? 'neutral'}>
                      {VITAL_FIELDS.find((f) => f.key === field)?.label ?? field}:{' '}
                      {VITAL_FLAG_LABELS[flag]}
                    </Badge>
                  ))}
              </div>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {VITAL_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="form-label" htmlFor={`vital-${field.key}`}>
                  {field.label} <span className="text-slate-400">({field.unit})</span>
                </label>
                <input
                  id={`vital-${field.key}`}
                  type="number"
                  inputMode="decimal"
                  step={field.step}
                  className="form-control"
                  value={form[field.key]}
                  onChange={update(field.key)}
                  placeholder="—"
                />
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Textarea
              label="Notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Position, oxygen delivery, anything qualifying the readings…"
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-slate-500">
              {filled.length} measurement{filled.length === 1 ? '' : 's'} entered
            </span>
            <Button loading={saving} onClick={submit} disabled={filled.length === 0}>
              Record observations
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export default VitalsForm;
