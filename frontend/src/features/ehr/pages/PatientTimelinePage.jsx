import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ehrApi, TIMELINE_TYPE_OPTIONS } from '../../../api/ehrApi.js';
import { ageFrom, formatDate, fullName } from '../../../utils/format.js';
import AllergyBanner from '../components/AllergyBanner.jsx';
import {
  Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner,
} from '../../../components/ui/index.js';

const TYPE_TONES = {
  encounter: 'purple',
  note: 'info',
  vitals: 'success',
  labOrder: 'warning',
  labResult: 'warning',
  radiologyOrder: 'info',
  radiologyResult: 'info',
  appointment: 'neutral',
};

const TYPE_LABELS = Object.fromEntries(
  TIMELINE_TYPE_OPTIONS.map((option) => [option.value, option.label.replace(/s$/, '')]),
);

/** Group events by calendar day so the eye can scan the chart by date. */
function groupByDay(events) {
  const groups = new Map();
  for (const item of events) {
    const key = new Date(item.date).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()];
}

/**
 * One patient, everything that happened, in order.
 *
 * The server merges each module's events and filters them by the caller's own
 * grants, so this page shows whatever the reader is entitled to and nothing
 * more — a receptionist sees that a visit happened without its clinical note.
 */
export function PatientTimelinePage() {
  const { id } = useParams();

  const [events, setEvents] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await ehrApi.timeline(id, {
        types: active.length ? active.join(',') : undefined,
        limit: 200,
      });
      setEvents(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [id, active]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (type) =>
    setActive((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));

  const patient = meta?.patient;
  const grouped = groupByDay(events);

  return (
    <div>
      <PageHeader
        breadcrumb={
          patient && (
            <Link to={`/patients/${id}`} className="text-sm text-brand-600 hover:text-brand-700">
              ← {fullName(patient)}
            </Link>
          )
        }
        title="Patient timeline"
        description={
          patient
            ? `${fullName(patient)} · ${patient.mrn} · ${ageFrom(patient.dateOfBirth) ?? '—'} yrs`
            : 'Everything recorded for this patient, newest first.'
        }
        action={
          <Link to={`/patients/${id}`}>
            <Button variant="secondary">Back to chart</Button>
          </Link>
        }
      />

      {error && (
        <Alert tone="error" title="Could not load the timeline" className="mb-4">
          {error}
        </Alert>
      )}

      {meta?.allergies && <AllergyBanner allergies={meta.allergies} className="mb-4" />}

      <div className="mb-5 flex flex-wrap gap-2">
        {TIMELINE_TYPE_OPTIONS.map((option) => {
          const on = active.includes(option.value);
          const count = meta?.byType?.[option.value] ?? 0;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={[
                'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                on
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              {option.label}
              {!active.length && count > 0 && (
                <span className="ml-1.5 text-xs opacity-70">{count}</span>
              )}
            </button>
          );
        })}
        {active.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setActive([])}>
            Show all
          </Button>
        )}
      </div>

      {loading ? (
        <Spinner label="Building the timeline…" className="py-16" />
      ) : events.length === 0 ? (
        <EmptyState
          icon="🕓"
          title="Nothing recorded yet"
          description="Visits, notes, observations, orders and results appear here as they happen."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <h2 className="mb-2 text-sm font-semibold text-slate-500">
                {formatDate(items[0].date)}
              </h2>

              <div className="relative space-y-2 border-l-2 border-slate-200 pl-5">
                {items.map((item) => (
                  <div key={`${item.type}-${item.resourceId}`} className="relative">
                    {/* The dot on the spine */}
                    <span
                      className="absolute -left-[27px] top-3 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] ring-2 ring-slate-200"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>

                    <Card className="!p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-900">{item.title}</span>
                            <Badge tone={TYPE_TONES[item.type] ?? 'neutral'}>
                              {TYPE_LABELS[item.type] ?? item.type}
                            </Badge>
                            {item.meta?.status && (
                              <Badge tone="neutral">{item.meta.status}</Badge>
                            )}
                            {item.meta?.hasCritical && <Badge tone="danger">critical</Badge>}
                            {item.meta?.amended && <Badge tone="warning">amended</Badge>}
                          </div>

                          {item.summary && (
                            <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
                          )}

                          <p className="mt-1 text-xs text-slate-400">
                            {new Date(item.date).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {item.meta?.author && ` · ${item.meta.author}`}
                            {item.meta?.doctor && ` · ${item.meta.doctor}`}
                            {item.meta?.recordedBy && ` · ${item.meta.recordedBy}`}
                          </p>
                        </div>

                        {item.encounterId && (
                          <Link
                            to={`/encounters/${item.encounterId}`}
                            className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Open visit →
                          </Link>
                        )}
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatientTimelinePage;
