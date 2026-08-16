import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { reportApi } from '../../../api/reportApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { MODULES } from '../../../utils/permissions.js';
import { fullName, formatDate } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, StatCard,
} from '../../../components/ui/index.js';

/**
 * The home page — a different dashboard for every role, from one request.
 *
 * `/reports/summary` returns only the sections the caller is entitled to, so the
 * shape of this page is decided by the server's permission matrix rather than by
 * a role check here. A receptionist gets no sections at all and simply sees the
 * patient panel; an admin gets all four.
 *
 * ---------------------------------------------------------------------------
 * A DASHBOARD'S JOB IS TO ANSWER "IS ANYTHING WRONG?"
 * ---------------------------------------------------------------------------
 * The previous version rendered sixteen identically-weighted stat cards in four
 * flat rows. Every figure looked equally important, so answering that question
 * meant reading all sixteen and deciding for yourself — which, at the start of a
 * shift, means nobody reads any of them.
 *
 * So the numbers are now ranked. Things that need a human to DO something are
 * lifted into an attention strip at the top; everything else is context and
 * recedes. When nothing needs attention the strip says so, because "all clear"
 * is a genuinely useful answer rather than an empty space.
 */

/**
 * Derive what actually needs attention.
 *
 * Kept as a pure function of the summary, deliberately: the thresholds are the
 * interesting part and they belong somewhere reviewable, not scattered through
 * JSX as inline ternaries.
 */
function deriveAttention({ operational, financial, clinical, workforce }, money) {
  const items = [];

  // Life-safety first, always. A critical result nobody has acknowledged is the
  // single most consequential thing this screen can surface.
  if (clinical?.criticalResults > 0) {
    items.push({
      tone: 'critical',
      label: `${clinical.criticalResults} critical result${clinical.criticalResults === 1 ? '' : 's'}`,
      detail: 'Verified values outside the critical range',
      to: '/lab',
    });
  }

  // Beds are a hard constraint: at 90%+ the hospital is about to start refusing
  // admissions, and that is a decision someone must make before it happens.
  if (operational?.beds?.total > 0) {
    const { available, total, occupancyRate } = operational.beds;
    if (occupancyRate >= 90 || available <= 2) {
      items.push({
        tone: available === 0 ? 'critical' : 'warning',
        label: available === 0 ? 'No beds available' : `Only ${available} bed${available === 1 ? '' : 's'} free`,
        detail: `${occupancyRate}% of ${total} occupied`,
        to: '/admissions',
      });
    }
  }

  if (financial?.unbilled?.charges > 0) {
    items.push({
      tone: 'warning',
      label: `${money(financial.unbilled.amount)} unbilled`,
      detail: `${financial.unbilled.charges} charge${financial.unbilled.charges === 1 ? '' : 's'} never invoiced`,
      to: '/billing',
    });
  }

  if (workforce?.unapprovedRecords > 0) {
    items.push({
      tone: 'warning',
      label: `${workforce.unapprovedRecords} attendance record${workforce.unapprovedRecords === 1 ? '' : 's'} unapproved`,
      detail: 'Unapproved days do not count toward pay',
      to: '/attendance',
    });
  }

  return items;
}

/** A horizontal fill bar. Occupancy is a proportion, and a number is not. */
function OccupancyBar({ percent, tone }) {
  const bars = { critical: 'bg-critical-500', warning: 'bg-warning-500', success: 'bg-success-500' };
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      role="img"
      aria-label={`${percent}% occupied`}
    >
      <div
        className={`h-full rounded-full transition-all ${bars[tone] ?? bars.success}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function AttentionStrip({ items }) {
  if (items.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-success-200 bg-success-50 px-4 py-2.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success-500 text-[10px] font-bold text-white">
          ✓
        </span>
        <p className="text-sm text-success-900">
          Nothing needs attention right now.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <p className="eyebrow mb-2">Needs attention</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className={[
              'group flex items-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 shadow-card',
              'transition-shadow hover:shadow-card-hover',
              item.tone === 'critical'
                ? 'border-critical-200 border-l-2 border-l-critical-500'
                : 'border-warning-200 border-l-2 border-l-warning-500',
            ].join(' ')}
          >
            <span
              className={[
                'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                item.tone === 'critical' ? 'animate-pulse-critical bg-critical-500' : 'bg-warning-500',
              ].join(' ')}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900">{item.label}</span>
              <span className="block truncate text-xs text-slate-500">{item.detail}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** A section band. Sections carry a heading, not a card, so they nest cleanly. */
function Section({ title, description, children }) {
  return (
    <section>
      <CardHeader title={title} description={description} className="mb-3" />
      {children}
    </section>
  );
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const { money, date } = useI18n();

  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const canReadPatients = can(MODULES.PATIENTS, 'view');
  const canOpenReports =
    can(MODULES.REPORTS, 'viewOperational') ||
    can(MODULES.REPORTS, 'viewFinancial') ||
    can(MODULES.REPORTS, 'viewClinical');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const requests = [reportApi.summary()];
        if (canReadPatients) {
          requests.push(api.get('/patients', { params: { limit: 5, sort: '-createdAt' } }));
        }

        const [summaryResponse, patients] = await Promise.all(requests);
        if (cancelled) return;

        setSummary(summaryResponse.data);
        setRecent(patients?.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadPatients]);

  /**
   * Memoised together: `summary?.sections ?? {}` allocates a fresh object on
   * every render, so deriving from it directly would defeat the memo below and
   * recompute the attention list on each keystroke elsewhere in the tree.
   */
  const sections = useMemo(() => summary?.sections ?? {}, [summary]);
  const { operational, financial, clinical, workforce } = sections;

  const attention = useMemo(
    () => (summary ? deriveAttention(sections, money) : []),
    [summary, sections, money],
  );

  const occupancy = operational?.beds?.occupancyRate ?? 0;
  const occupancyTone = occupancy >= 90 ? 'critical' : occupancy >= 75 ? 'warning' : 'success';

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.firstName ?? 'there'}`}
        // Today's date in Bikram Sambat — the calendar the ward whiteboard uses.
        description={date(new Date(), { withWeekday: true })}
        action={
          canOpenReports ? (
            <Link to="/reports">
              <Button variant="secondary">Reports</Button>
            </Link>
          ) : null
        }
      />

      {error && (
        <Alert tone="error" title="Could not load dashboard" className="mb-6">
          {error}
        </Alert>
      )}

      {loading ? (
        /* Skeletons rather than a spinner: they hold the shape the content will
           take, so the page does not jump when data lands. On a slow ward
           connection that reflow is what makes a page feel broken. */
        <div className="space-y-6">
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-7">
          {summary && <AttentionStrip items={attention} />}

          {operational && (
            <Section title="Today" description="Flow through the hospital since midnight.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Open visits"
                  value={operational.openVisits}
                  tone="brand"
                  icon="🩺"
                  hint={`${operational.today.visits} started today`}
                />
                <StatCard
                  label="Appointments today"
                  value={operational.today.appointments}
                  tone="slate"
                  icon="📅"
                />
                <StatCard
                  label="Admissions today"
                  value={operational.today.admissions}
                  tone="brand"
                  icon="🛏️"
                  hint={`${operational.today.discharges} discharged`}
                />

                {/* Beds get their own card rather than a StatCard: occupancy is a
                    proportion, and a bar shows "nearly full" in a way that
                    "82%" does not. */}
                <Card className="relative overflow-hidden">
                  <span
                    className={`absolute inset-x-0 top-0 h-0.5 ${
                      occupancyTone === 'critical'
                        ? 'bg-critical-500'
                        : occupancyTone === 'warning'
                          ? 'bg-warning-500'
                          : 'bg-success-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="flex items-start justify-between gap-3">
                    <p className="eyebrow">Beds available</p>
                    <span className="-mt-1 text-base opacity-70" aria-hidden="true">🏥</span>
                  </div>
                  <p className="tabular mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight text-slate-900">
                    {operational.beds.available}
                    <span className="text-base font-normal text-slate-400"> / {operational.beds.total}</span>
                  </p>
                  <OccupancyBar percent={occupancy} tone={occupancyTone} />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {occupancy}% occupied · {operational.beds.unavailable} out of service
                  </p>
                </Card>
              </div>
            </Section>
          )}

          {financial && (
            <Section
              title="Money"
              description="Billed is what was invoiced; collected is what actually arrived. They are not the same number."
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Every figure below goes through `money()`. Previously these
                    rendered as bare numbers — a Nepali hospital's dashboard
                    showing 1234567.89 rather than रू १२,३४,५६७.८९ — despite the
                    formatter existing. */}
                <StatCard
                  label="Billed today"
                  value={money(financial.today.billed)}
                  tone="slate"
                  hint={`${money(financial.month.billed)} this month`}
                />
                <StatCard
                  label="Collected today"
                  value={money(financial.today.collected)}
                  tone="success"
                  hint={`${money(financial.month.collected)} this month`}
                />
                <StatCard
                  label="Outstanding"
                  value={money(financial.outstanding.amount)}
                  tone={financial.outstanding.amount > 0 ? 'warning' : 'slate'}
                  hint={`across ${financial.outstanding.invoices} invoice(s)`}
                />
                <StatCard
                  label="Unbilled charges"
                  value={money(financial.unbilled.amount)}
                  tone={financial.unbilled.charges > 0 ? 'warning' : 'slate'}
                  hint={`${financial.unbilled.charges} charge(s) never invoiced`}
                />
              </div>
            </Section>
          )}

          {clinical && (
            <Section title="Diagnostics" description="What is still waiting on a result.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Lab pending"
                  value={clinical.labPending}
                  tone={clinical.labPending > 0 ? 'warning' : 'slate'}
                  icon="🧪"
                />
                <StatCard
                  label="Imaging pending"
                  value={clinical.radiologyPending}
                  tone={clinical.radiologyPending > 0 ? 'warning' : 'slate'}
                  icon="🩻"
                />
                {/* Was `brand` when non-zero — a critical result rendering in
                    navigation blue, the one colour that means "nothing is
                    wrong". Inverted to the severity scale. */}
                <StatCard
                  label="Critical results"
                  value={clinical.criticalResults}
                  tone={clinical.criticalResults > 0 ? 'critical' : 'slate'}
                  icon="⚠️"
                  hint="Verified results with a critical value"
                />
                <StatCard label="Visits today" value={clinical.visitsToday} tone="slate" icon="👥" />
              </div>
            </Section>
          )}

          {workforce && (
            <Section title="Workforce">
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard
                  label="On duty today"
                  value={workforce.onDutyToday}
                  tone="success"
                  icon="🧑‍⚕️"
                />
                <StatCard
                  label="Attendance awaiting approval"
                  value={workforce.unapprovedRecords}
                  tone={workforce.unapprovedRecords > 0 ? 'warning' : 'slate'}
                  icon="🕒"
                  hint="Unapproved days do not count toward pay once approval starts"
                />
              </div>
            </Section>
          )}

          {canReadPatients && (
            <Card padded={false}>
              <CardHeader
                title="Recently registered"
                description="The five most recent registrations"
                className="mb-0 p-5 pb-3"
                action={
                  <Link
                    to="/patients"
                    className="text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    View all →
                  </Link>
                }
              />
              {recent.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState
                    icon="🧑‍⚕️"
                    title="No patients registered yet"
                    description="Registrations will appear here as they are created."
                    className="border-0 bg-transparent py-8"
                  />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {recent.map((patient) => (
                    <li key={patient._id}>
                      <Link
                        to={`/patients/${patient._id}`}
                        className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-slate-50"
                      >
                        {/* Initials rather than a generic avatar glyph — a real
                            distinguishing mark when five rows look alike. */}
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-2xs font-semibold text-brand-700"
                          aria-hidden="true"
                        >
                          {(patient.firstName?.[0] ?? '') + (patient.lastName?.[0] ?? '')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {fullName(patient)}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            <span className="tabular">{patient.mrn}</span> ·{' '}
                            {formatDate(patient.createdAt)}
                          </p>
                        </div>
                        <Badge tone={patient.status === 'active' ? 'success' : 'neutral'} dot>
                          {patient.status}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* A role with no reporting grants and no patient access would
              otherwise land on a blank page. */}
          {summary?.available?.length === 0 && !canReadPatients && (
            <EmptyState
              icon="🧭"
              title="No dashboard panels for your role"
              description="Use the sidebar to reach your work. Nothing is missing — this page simply has nothing to show you."
            />
          )}
        </div>
      )}
    </div>
  );
}

export default DashboardPage;
