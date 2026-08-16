import { useCallback, useEffect, useState } from 'react';
import {
  admissionApi,
  CONSCIOUSNESS_OPTIONS,
  MOBILITY_OPTIONS,
  RISK_OPTIONS,
  ROUND_CHECKS,
} from '../../../api/admissionApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Select, Spinner, Textarea,
} from '../../../components/ui/index.js';

const EMPTY = {
  consciousness: 'alert',
  mobility: 'independent',
  painScore: '',
  intakeMl: '',
  outputMl: '',
  fallRisk: 'low',
  escalated: false,
  escalationReason: '',
  notes: '',
  ...Object.fromEntries(ROUND_CHECKS.map((check) => [check.key, false])),
};

const RISK_TONES = { low: 'success', medium: 'warning', high: 'danger' };

/**
 * Ward rounds: the structured nursing check on an admitted patient.
 *
 * Sits between observations (numbers) and notes (prose) — repositioning,
 * pressure-area care and fall risk are recorded as fields rather than buried in
 * free text, because that is what pressure-ulcer and falls reporting has to
 * count later.
 */
export function RoundsPanel({ encounterId, canRecord, admitted }) {
  const [rounds, setRounds] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await admissionApi.listRounds(encounterId);
      setRounds(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setError(null);

    if (form.escalated && form.escalationReason.trim().length < 5) {
      return setError('Say why the round is being escalated.');
    }

    const payload = {
      consciousness: form.consciousness,
      mobility: form.mobility,
      fallRisk: form.fallRisk,
      escalated: form.escalated,
      ...Object.fromEntries(ROUND_CHECKS.map((check) => [check.key, form[check.key]])),
    };
    if (form.painScore !== '') payload.painScore = Number(form.painScore);
    if (form.intakeMl !== '') payload.intakeMl = Number(form.intakeMl);
    if (form.outputMl !== '') payload.outputMl = Number(form.outputMl);
    if (form.notes.trim()) payload.notes = form.notes.trim();
    if (form.escalated) payload.escalationReason = form.escalationReason.trim();

    setSaving(true);
    try {
      const response = await admissionApi.recordRound(encounterId, payload);
      setNotice(response.message);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <Card>
          <CardHeader
            title="Record a round"
            description="The structured ward check — repositioning, lines, fall risk, fluid balance."
          />

          {!admitted ? (
            <Alert tone="neutral">
              Ward rounds are recorded against an admitted patient. Admit them to a bed first.
            </Alert>
          ) : !canRecord ? (
            <Alert tone="neutral">Your role does not include recording ward rounds.</Alert>
          ) : (
            <>
              {error && (
                <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
                  {error}
                </Alert>
              )}
              {notice && (
                <Alert tone="success" className="mb-3" onDismiss={() => setNotice(null)}>
                  {notice}
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Consciousness"
                  options={CONSCIOUSNESS_OPTIONS}
                  value={form.consciousness}
                  onChange={(e) => set('consciousness', e.target.value)}
                />
                <Select
                  label="Mobility"
                  options={MOBILITY_OPTIONS}
                  value={form.mobility}
                  onChange={(e) => set('mobility', e.target.value)}
                />
                <div>
                  <label className="form-label" htmlFor="round-pain">Pain score (0–10)</label>
                  <input
                    id="round-pain" type="number" min="0" max="10" className="form-control"
                    value={form.painScore} onChange={(e) => set('painScore', e.target.value)}
                  />
                </div>
                <Select
                  label="Fall risk"
                  options={RISK_OPTIONS}
                  value={form.fallRisk}
                  onChange={(e) => set('fallRisk', e.target.value)}
                />
                <div>
                  <label className="form-label" htmlFor="round-intake">Intake (ml)</label>
                  <input
                    id="round-intake" type="number" min="0" className="form-control"
                    value={form.intakeMl} onChange={(e) => set('intakeMl', e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="round-output">Output (ml)</label>
                  <input
                    id="round-output" type="number" min="0" className="form-control"
                    value={form.outputMl} onChange={(e) => set('outputMl', e.target.value)}
                  />
                </div>
              </div>

              <fieldset className="mt-4">
                <legend className="form-label">Care given</legend>
                <div className="grid grid-cols-2 gap-2">
                  {ROUND_CHECKS.map((check) => (
                    <label key={check.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={form[check.key]}
                        onChange={(e) => set(check.key, e.target.checked)}
                      />
                      {check.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-4">
                <Textarea
                  label="Notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Anything the next nurse should know."
                />
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={form.escalated}
                  onChange={(e) => set('escalated', e.target.checked)}
                />
                Escalate to a doctor
              </label>

              {form.escalated && (
                <div className="mt-2">
                  <Textarea
                    label="Escalation reason"
                    required
                    rows={2}
                    value={form.escalationReason}
                    onChange={(e) => set('escalationReason', e.target.value)}
                    placeholder="Drowsy and hypotensive — doctor asked to review."
                  />
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button loading={saving} onClick={submit}>
                  Record round
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <div>
        <CardHeader
          title="Round history"
          description={meta ? `${meta.count} round(s), ${meta.escalated} escalated` : undefined}
        />

        {loading ? (
          <Spinner label="Loading rounds…" className="py-8" />
        ) : rounds.length === 0 ? (
          <EmptyState
            icon="🩺"
            title="No rounds recorded"
            description="Ward rounds performed during this stay appear here, newest first."
          />
        ) : (
          <div className="space-y-2">
            {rounds.map((round) => (
              <Card key={round._id} className="!p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {formatDate(round.roundAt, { withTime: true })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {fullName(round.performedBy)}
                      {round.bedId?.bedNumber ? ` · bed ${round.bedId.bedNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="neutral">{round.consciousness}</Badge>
                    <Badge tone={RISK_TONES[round.fallRisk] ?? 'neutral'}>
                      fall risk {round.fallRisk}
                    </Badge>
                    {round.escalated && <Badge tone="danger">escalated</Badge>}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span>Mobility: {round.mobility}</span>
                  {round.painScore !== undefined && <span>Pain {round.painScore}/10</span>}
                  {round.fluidBalanceMl !== null && round.fluidBalanceMl !== undefined && (
                    <span>
                      Balance {round.fluidBalanceMl > 0 ? '+' : ''}
                      {round.fluidBalanceMl} ml
                    </span>
                  )}
                </div>

                {ROUND_CHECKS.some((check) => round[check.key]) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ROUND_CHECKS.filter((check) => round[check.key]).map((check) => (
                      <Badge key={check.key} tone="success">
                        {check.label}
                      </Badge>
                    ))}
                  </div>
                )}

                {round.escalationReason && (
                  <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800">
                    <span className="font-semibold">Escalated:</span> {round.escalationReason}
                  </p>
                )}

                {round.notes && <p className="mt-2 text-sm text-slate-700">{round.notes}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RoundsPanel;
