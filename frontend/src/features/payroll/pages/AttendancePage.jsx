import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  payrollApi,
  ATTENDANCE_STATUS_OPTIONS,
  ATTENDANCE_STATUS_TONES,
  SHIFT_OPTIONS,
  currentPeriod,
  periodLabel,
} from '../../../api/payrollApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName, titleCase } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, Input, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const REGISTER_COLUMNS = [
  { key: 'staff', label: 'Staff' },
  { key: 'date', label: 'Date' },
  { key: 'hours', label: 'Hours' },
  { key: 'status', label: 'Status' },
  { key: 'approval', label: 'Approved' },
  { key: 'actions', label: '' },
];

const SUMMARY_COLUMNS = [
  { key: 'staff', label: 'Staff' },
  { key: 'present', label: 'Present' },
  { key: 'half', label: 'Half' },
  { key: 'leave', label: 'Leave' },
  { key: 'absent', label: 'Absent' },
  { key: 'payable', label: 'Payable days' },
  { key: 'overtime', label: 'Overtime' },
];

const TABS = [
  { key: 'summary', label: 'Monthly summary' },
  { key: 'register', label: 'Register' },
];

/**
 * The attendance register — the input to every payslip.
 *
 * Approval matters more than it looks: once ANY record in a period is approved,
 * payroll counts only approved days. That keeps a half-checked month from
 * quietly paying everyone in full, and is why the register flags what is still
 * waiting.
 */
export function AttendancePage() {
  const { can } = usePermissions();
  const canRecord = can(MODULES.ATTENDANCE, 'create');
  const canApprove = can(MODULES.ATTENDANCE, 'edit');
  const canRoster = can(MODULES.ATTENDANCE, 'manageShifts');

  const [tab, setTab] = useState('summary');
  const [period, setPeriod] = useState(currentPeriod);
  const [unapprovedOnly, setUnapprovedOnly] = useState(false);

  const [summary, setSummary] = useState([]);
  const [meta, setMeta] = useState(null);
  const [records, setRecords] = useState([]);
  const [staff, setStaff] = useState([]);

  const [form, setForm] = useState({
    userId: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'present',
    shift: 'morning',
    notes: '',
  });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'summary') {
        const response = await payrollApi.attendanceSummary({ period });
        setSummary(response.data);
        setMeta(response.meta);
      } else {
        const [year, month] = period.split('-').map(Number);
        const response = await payrollApi.listAttendance({
          from: new Date(year, month - 1, 1).toISOString(),
          to: new Date(year, month, 0).toISOString(),
          unapprovedOnly: unapprovedOnly ? 'true' : undefined,
          limit: 200,
        });
        setRecords(response.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, period, unapprovedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canRecord) return;
    staffApi.directory({ limit: 200 }).then((response) => setStaff(response.data)).catch(() => {});
  }, [canRecord]);

  const record = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await payrollApi.recordAttendance({
        userId: form.userId,
        date: new Date(form.date).toISOString(),
        status: form.status,
        shift: form.shift,
        notes: form.notes.trim() || undefined,
      });
      setNotice(response.message);
      setForm((f) => ({ ...f, notes: '' }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (row) => {
    setBusyId(row._id);
    setError(null);
    try {
      const response = await payrollApi.approveAttendance(row._id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="What each person worked, and what payroll will pay them for."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canRoster && (
              <Link to="/attendance/roster">
                <Button variant="secondary">Shift roster</Button>
              </Link>
            )}
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value || currentPeriod())}
              aria-label="Period"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        }
      />

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {canRecord && (
        <Card className="mb-4">
          <CardHeader
            title="Record a day"
            description="Correcting a colleague's day changes what they are paid, so it is recorded against your name."
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Select
                label="Staff member"
                placeholder="Choose…"
                options={staff.map((person) => ({
                  value: person._id,
                  label: `${person.firstName} ${person.lastName}`,
                }))}
                value={form.userId}
                onChange={(event) => setForm((f) => ({ ...f, userId: event.target.value }))}
              />
            </div>
            <div className="w-40">
              <Input
                label="Date"
                type="date"
                value={form.date}
                onChange={(event) => setForm((f) => ({ ...f, date: event.target.value }))}
              />
            </div>
            <div className="w-36">
              <Select
                label="Status"
                options={ATTENDANCE_STATUS_OPTIONS}
                value={form.status}
                onChange={(event) => setForm((f) => ({ ...f, status: event.target.value }))}
              />
            </div>
            <div className="w-36">
              <Select
                label="Shift"
                options={SHIFT_OPTIONS}
                value={form.shift}
                onChange={(event) => setForm((f) => ({ ...f, shift: event.target.value }))}
              />
            </div>
            <div className="w-48">
              <Input
                label="Notes"
                value={form.notes}
                onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
              />
            </div>
            <Button loading={busy} disabled={!form.userId} onClick={record}>
              Record
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={[
                'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                tab === item.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'summary' && (
        loading ? (
          <Spinner label="Building the summary…" className="py-10" />
        ) : (
          <>
            {meta && (
              <p className="mb-3 text-sm text-slate-500">
                {periodLabel(period)} · {meta.staffCount} staff · {meta.totalPayableDays} payable
                days · {meta.totalOvertimeHours}h overtime
              </p>
            )}
            <Table>
              <THead columns={SUMMARY_COLUMNS} />
              <TBody>
                {summary.length === 0 && (
                  <TRMessage colSpan={SUMMARY_COLUMNS.length}>No staff to summarise.</TRMessage>
                )}
                {summary.map((row) => (
                  <TR key={String(row.userId)}>
                    <TD>
                      <div className="font-medium text-slate-900">{row.name}</div>
                      <div className="text-xs text-slate-400">{titleCase(row.role)}</div>
                    </TD>
                    <TD>{row.daysPresent}</TD>
                    <TD>{row.daysHalf}</TD>
                    <TD>{row.daysLeave}</TD>
                    <TD className={row.daysAbsent > 0 ? 'text-rose-600' : undefined}>
                      {row.daysAbsent}
                    </TD>
                    <TD className="font-semibold">{row.payableDays}</TD>
                    <TD>{row.overtimeHours > 0 ? `${row.overtimeHours}h` : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-3 text-xs text-slate-500">
              Once any day in a period is approved, only approved days count toward pay.
            </p>
          </>
        )
      )}

      {tab === 'register' && (
        <>
          <label className="mb-3 flex w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={unapprovedOnly}
              onChange={(event) => setUnapprovedOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Waiting for approval
          </label>

          <Table>
            <THead columns={REGISTER_COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={REGISTER_COLUMNS.length}>Loading…</TRMessage>}
              {!loading && records.length === 0 && (
                <TRMessage colSpan={REGISTER_COLUMNS.length}>
                  Nothing recorded for {periodLabel(period)}.
                </TRMessage>
              )}
              {!loading &&
                records.map((row) => (
                  <TR key={row._id}>
                    <TD>
                      <div className="font-medium text-slate-900">{fullName(row.userId)}</div>
                      <div className="text-xs text-slate-400">{titleCase(row.userId?.role)}</div>
                    </TD>
                    <TD>{formatDate(row.date)}</TD>
                    <TD>
                      {row.hoursWorked || '—'}
                      {row.overtimeHours > 0 && (
                        <span className="ml-1 text-xs text-amber-600">+{row.overtimeHours} OT</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={ATTENDANCE_STATUS_TONES[row.status] ?? 'neutral'}>
                        {row.status}
                      </Badge>
                    </TD>
                    <TD>
                      {row.approvedBy ? (
                        <span className="text-xs text-slate-500">
                          {fullName(row.approvedBy)}
                          <br />
                          {formatDate(row.approvedAt)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        {canApprove && !row.approvedBy && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busyId === row._id}
                            onClick={() => approve(row)}
                          >
                            Approve
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}

export default AttendancePage;
