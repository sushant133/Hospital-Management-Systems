import { useCallback, useEffect, useMemo, useState } from 'react';
import { payrollApi, SHIFT_OPTIONS } from '../../../api/payrollApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, PageHeader, Select, Spinner,
} from '../../../components/ui/index.js';

const SHIFT_TONES = { morning: 'info', evening: 'warning', night: 'purple' };
const SHIFT_CYCLE = [null, 'morning', 'evening', 'night'];

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDay(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`;
}

export function RosterPage() {
  const { can } = useAuth();
  const canManage = can(MODULES.ATTENDANCE, 'manageShifts');

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);

  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    departmentsApi.list({ limit: 100, sort: 'name' })
      .then((r) => setDepartments(r.data))
      .catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, staffRes] = await Promise.all([
        payrollApi.listRosters({
          weekStart: weekStart.toISOString(),
          departmentId: departmentId || undefined,
          limit: 5,
        }),
        staffApi.directory({
          departmentId: departmentId || undefined,
          limit: 200,
        }),
      ]);

      const match = (rosterRes.data ?? []).find((row) => {
        const rowDept = row.departmentId?._id ?? row.departmentId ?? '';
        return String(rowDept) === String(departmentId);
      }) ?? rosterRes.data?.[0] ?? null;

      if (match?._id) {
        const detail = await payrollApi.getRoster(match._id);
        setRoster(detail.data);
      } else {
        setRoster(null);
      }
      setStaff(staffRes.data ?? []);
    } catch (err) {
      setError(err.message);
      setRoster(null);
    } finally {
      setLoading(false);
    }
  }, [weekStart, departmentId]);

  useEffect(() => { load(); }, [load]);

  const byCell = useMemo(() => {
    const map = new Map();
    for (const row of roster?.assignments ?? []) {
      const uid = row.userId?._id ?? row.userId;
      map.set(`${uid}|${isoDay(row.date)}`, row);
    }
    return map;
  }, [roster]);

  const run = async (fn, success) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fn();
      setNotice(success ?? response?.message ?? 'Done');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createWeek = () =>
    run(
      () => payrollApi.createRoster({
        weekStart: weekStart.toISOString(),
        departmentId: departmentId || undefined,
      }),
      'Draft week created',
    );

  const cycleCell = async (member, day) => {
    if (!canManage || roster?.status === 'published' || !roster?._id) return;
    const key = `${member._id}|${isoDay(day)}`;
    const current = byCell.get(key);
    const currentShift = current?.shift ?? null;
    const next = SHIFT_CYCLE[(SHIFT_CYCLE.indexOf(currentShift) + 1) % SHIFT_CYCLE.length];

    setBusy(true);
    setError(null);
    try {
      if (!next) {
        if (current?._id) await payrollApi.clearShift(roster._id, current._id);
      } else {
        await payrollApi.assignShift(roster._id, {
          userId: member._id,
          date: isoDay(day),
          shift: next,
        });
      }
      const detail = await payrollApi.getRoster(roster._id);
      setRoster(detail.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const published = roster?.status === 'published';
  const departmentOptions = [
    { value: '', label: 'Hospital-wide' },
    ...departments.map((d) => ({ value: d._id, label: `${d.code} — ${d.name}` })),
  ];

  return (
    <div>
      <PageHeader
        title="Shift roster"
        description="Who is expected on which shift. Publishing is what makes the plan visible on My pay. Attendance still records what actually happened."
        action={
          canManage && roster && (
            <div className="flex flex-wrap gap-2">
              {published ? (
                <Button variant="secondary" loading={busy} onClick={() => run(() => payrollApi.unpublishRoster(roster._id), 'Unpublished')}>
                  Unpublish
                </Button>
              ) : (
                <>
                  <Button loading={busy} onClick={() => run(() => payrollApi.publishRoster(roster._id), 'Published')}>
                    Publish week
                  </Button>
                  <Button variant="ghost" loading={busy} onClick={() => run(() => payrollApi.deleteRoster(roster._id), 'Draft removed')}>
                    Discard draft
                  </Button>
                </>
              )}
            </div>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous</Button>
        <div className="px-2 py-2 text-sm font-medium text-slate-800">{weekLabel(weekStart)}</div>
        <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</Button>
        <Button variant="ghost" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</Button>
        <Select
          label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          options={departmentOptions}
          className="w-56"
        />
      </div>

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Spinner label="Loading roster…" className="py-16" />
      ) : !roster ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="text-sm text-slate-600">No roster for this week yet.</p>
          {canManage && (
            <Button className="mt-4" onClick={createWeek} loading={busy}>
              Draft this week
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={published ? 'success' : 'neutral'}>{roster.status}</Badge>
            <span className="text-slate-500">
              {roster.assignments?.length ?? 0} assignment(s)
              {roster.departmentId?.name ? ` · ${roster.departmentId.name}` : ' · hospital-wide'}
            </span>
            {!published && canManage && (
              <span className="text-xs text-slate-400">Click a cell to cycle Morning → Evening → Night → clear</span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Staff
                  </th>
                  {days.map((day) => (
                    <th key={isoDay(day)} className="px-2 py-2 text-center text-xs font-semibold text-slate-600">
                      <div>{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                      <div className="font-normal text-slate-400">{day.getDate()}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staff.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      No staff in this department.
                    </td>
                  </tr>
                )}
                {staff.map((member) => (
                  <tr key={member._id}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="font-medium text-slate-900">{fullName(member)}</div>
                      <div className="text-xs text-slate-400">{member.role}</div>
                    </td>
                    {days.map((day) => {
                      const cell = byCell.get(`${member._id}|${isoDay(day)}`);
                      const shift = cell?.shift;
                      const label = SHIFT_OPTIONS.find((o) => o.value === shift)?.label ?? '—';
                      return (
                        <td key={isoDay(day)} className="px-1 py-1 text-center">
                          <button
                            type="button"
                            disabled={!canManage || published || busy}
                            onClick={() => cycleCell(member, day)}
                            className={[
                              'w-full rounded-md px-1 py-2 text-xs font-medium',
                              shift
                                ? ''
                                : 'text-slate-300 hover:bg-slate-50',
                              !canManage || published ? 'cursor-default' : 'cursor-pointer hover:ring-1 hover:ring-slate-300',
                            ].join(' ')}
                          >
                            {shift ? (
                              <Badge tone={SHIFT_TONES[shift] ?? 'neutral'}>{label}</Badge>
                            ) : (
                              '·'
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {roster.coverage && (
            <div className="mt-4 grid gap-2 sm:grid-cols-7">
              {days.map((day) => {
                const cells = (roster.coverage ?? []).filter((c) => isoDay(c.date) === isoDay(day));
                return (
                  <div key={isoDay(day)} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
                    <div className="mb-1 font-medium text-slate-700">
                      {day.toLocaleDateString(undefined, { weekday: 'short' })}
                    </div>
                    {SHIFT_OPTIONS.map((s) => {
                      const count = cells.find((c) => c.shift === s.value)?.count ?? 0;
                      return (
                        <div key={s.value} className="flex justify-between text-slate-500">
                          <span>{s.label}</span>
                          <span className={count === 0 ? 'text-amber-600' : 'text-slate-800'}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RosterPage;
