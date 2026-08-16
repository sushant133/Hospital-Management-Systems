import { useMemo, useState } from 'react';
import { labApi, FLAG_TONES, FLAG_LABELS } from '../../../api/labApi.js';
import { Alert, Badge, Button, Card, CardHeader, Input, Select, Textarea } from '../../../components/ui/index.js';

/**
 * Client-side preview of the flag the server will assign. Mirrors
 * backend/src/services/labService.js — the server remains authoritative;
 * this only gives the technician immediate feedback while typing.
 */
function previewFlag(analyte, raw) {
  if (raw === '' || raw === undefined || raw === null) return null;

  const cleaned = String(raw).trim().replace(/,/g, '').replace(/^[<>≤≥]=?/, '');
  const numeric = Number(cleaned);

  if (analyte.valueType === 'text' || !Number.isFinite(numeric)) {
    const normal = (analyte.normalValue ?? '').trim().toLowerCase();
    if (!normal) return 'normal';
    return String(raw).trim().toLowerCase() === normal ? 'normal' : 'abnormal';
  }

  const { refLow, refHigh, criticalLow, criticalHigh } = analyte;
  if (criticalLow != null && numeric <= criticalLow) return 'critical-low';
  if (criticalHigh != null && numeric >= criticalHigh) return 'critical-high';
  if (refLow != null && numeric < refLow) return 'low';
  if (refHigh != null && numeric > refHigh) return 'high';
  return 'normal';
}

function rangeLabel(analyte) {
  const { refLow, refHigh, normalValue, expectedValues } = analyte;
  if (refLow != null && refHigh != null) return `${refLow} – ${refHigh}`;
  if (refHigh != null) return `< ${refHigh}`;
  if (refLow != null) return `> ${refLow}`;
  if (normalValue) return `Normal: ${normalValue}`;
  if (expectedValues?.length) return expectedValues.join(' / ');
  return '—';
}

/**
 * Result entry for ONE test on an order.
 *
 * `existing` is the already-saved result, if any. A verified result is
 * read-only here and must go through the amend flow.
 */
export function ResultEntryForm({ orderId, test, existing, onSaved }) {
  const isLocked = existing && ['verified', 'amended'].includes(existing.status);

  const initialValues = useMemo(() => {
    const seed = {};
    for (const analyte of test.analytes) {
      const prior = existing?.values?.find((v) => v.analyteCode === analyte.code);
      seed[analyte.code] = prior?.value ?? '';
    }
    return seed;
  }, [test, existing]);

  const [values, setValues] = useState(initialValues);
  const [notes, setNotes] = useState(existing?.technicianNotes ?? '');
  const [interpretation, setInterpretation] = useState(existing?.interpretation ?? '');
  const [amendReason, setAmendReason] = useState('');
  const [amending, setAmending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const sortedAnalytes = [...test.analytes].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
  );

  const editable = !isLocked || amending;

  const submit = async (status) => {
    setError(null);
    setFieldErrors({});

    const entries = sortedAnalytes
      .filter((a) => String(values[a.code] ?? '').trim() !== '')
      .map((a) => ({ analyteCode: a.code, value: String(values[a.code]).trim() }));

    if (entries.length === 0) {
      setError('Enter at least one value before saving.');
      return;
    }
    if (status === 'verified' && entries.length !== sortedAnalytes.length) {
      setError('All analytes must have a value before the result can be verified. Save as draft instead.');
      return;
    }
    if (amending && amendReason.trim().length < 5) {
      setError('Give a reason for the amendment (at least 5 characters).');
      return;
    }

    setSaving(true);
    try {
      if (amending) {
        await labApi.amendResult(orderId, existing._id, {
          entries,
          technicianNotes: notes,
          interpretation,
          amendmentReason: amendReason.trim(),
        });
      } else {
        await labApi.submitResult(orderId, {
          labTestId: test._id,
          entries,
          technicianNotes: notes,
          interpretation,
          status,
        });
      }
      setAmending(false);
      setAmendReason('');
      onSaved?.();
    } catch (err) {
      setFieldErrors(err.fieldErrors ?? {});
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {test.name}
            <Badge tone="info">{test.code}</Badge>
            {existing && (
              <Badge tone={existing.status === 'preliminary' ? 'warning' : 'success'}>
                {existing.status}
              </Badge>
            )}
          </span>
        }
        description={`Specimen: ${test.specimen} · ${sortedAnalytes.length} analyte(s)`}
        action={
          isLocked && !amending ? (
            <Button size="sm" variant="secondary" onClick={() => setAmending(true)}>
              Amend
            </Button>
          ) : null
        }
      />

      {error && (
        <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isLocked && !amending && (
        <Alert tone="info" className="mb-3">
          This result is signed off. Use <strong>Amend</strong> to correct it — the report will be
          regenerated.
        </Alert>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-semibold">Analyte</th>
              <th className="py-2 pr-3 font-semibold">Result</th>
              <th className="py-2 pr-3 font-semibold">Unit</th>
              <th className="py-2 pr-3 font-semibold">Reference</th>
              <th className="py-2 font-semibold">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedAnalytes.map((analyte) => {
              const raw = values[analyte.code] ?? '';
              const flag = previewFlag(analyte, raw);

              return (
                <tr key={analyte.code}>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-900">{analyte.name}</div>
                    <div className="font-mono text-[11px] text-slate-400">{analyte.code}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {analyte.valueType === 'text' && analyte.expectedValues?.length ? (
                      <Select
                        options={analyte.expectedValues.map((v) => ({ value: v, label: v }))}
                        placeholder="—"
                        value={raw}
                        disabled={!editable}
                        onChange={(e) => setValues({ ...values, [analyte.code]: e.target.value })}
                        className="w-36"
                      />
                    ) : (
                      <Input
                        value={raw}
                        disabled={!editable}
                        onChange={(e) => setValues({ ...values, [analyte.code]: e.target.value })}
                        placeholder="—"
                        className="w-32"
                        error={fieldErrors.entries}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{analyte.unit || '—'}</td>
                  <td className="py-2 pr-3 text-slate-500">{rangeLabel(analyte)}</td>
                  <td className="py-2">
                    {flag ? (
                      <Badge tone={FLAG_TONES[flag] ?? 'neutral'}>{FLAG_LABELS[flag]}</Badge>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Textarea
          label="Technician notes"
          rows={2}
          value={notes}
          disabled={!editable}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Textarea
          label="Interpretation"
          rows={2}
          value={interpretation}
          disabled={!editable}
          onChange={(e) => setInterpretation(e.target.value)}
        />
      </div>

      {amending && (
        <Input
          label="Reason for amendment"
          className="mt-3"
          value={amendReason}
          onChange={(e) => setAmendReason(e.target.value)}
          placeholder="e.g. Transcription error on potassium"
          required
        />
      )}

      {editable && (
        <div className="mt-4 flex justify-end gap-2">
          {amending && (
            <Button variant="ghost" onClick={() => { setAmending(false); setAmendReason(''); }}>
              Cancel
            </Button>
          )}
          {!amending && (
            <Button variant="secondary" loading={saving} onClick={() => submit('preliminary')}>
              Save draft
            </Button>
          )}
          <Button loading={saving} onClick={() => submit('verified')}>
            {amending ? 'Save amendment' : 'Verify & sign off'}
          </Button>
        </div>
      )}
    </Card>
  );
}

export default ResultEntryForm;
