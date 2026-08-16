import { useCallback, useEffect, useState } from 'react';
import {
  payrollApi,
  ATTENDANCE_STATUS_TONES,
  SHIFT_OPTIONS,
  currentPeriod,
  periodLabel,
} from '../../../api/payrollApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { formatDate } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, PageHeader, Select, Spinner, StatCard,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const ATTENDANCE_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'shift', label: 'Shift' },
  { key: 'in', label: 'In' },
  { key: 'out', label: 'Out' },
  { key: 'hours', label: 'Hours' },
  { key: 'status', label: 'Status' },
];

const time = (value) =>
  value ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * My pay and attendance — the one payroll page every role can open.
 *
 * It reads the `/me` endpoints, which need no grant over anyone else's record,
 * so a nurse seeing her own payslip here never implies she could see a
 * colleague's. Draft runs are deliberately absent: a figure that is still being
 * rebuilt is not yet anyone's pay.
 */
export function PayslipPage() {
  const { user } = useAuth();

  const [period, setPeriod] = useState(currentPeriod);
  const [attendance, setAttendance] = useState([]);
  const [planned, setPlanned] = useState([]);
  const [summary, setSummary] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [pendingRuns, setPendingRuns] = useState(0);
  const [openSlip, setOpenSlip] = useState(null);
  const [shift, setShift] = useState('morning');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [days, pay, roster] = await Promise.all([
        payrollApi.myAttendance({ period }),
        payrollApi.myPayslips(),
        payrollApi.myRoster({}),
      ]);
      setAttendance(days.data);
      setSummary(days.meta?.summary ?? null);
      setPayslips(pay.data);
      setPendingRuns(pay.meta?.pendingRuns ?? 0);
      setPlanned(roster.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const clock = async (direction) => {
    setBusy(true);
    setError(null);
    try {
      const response =
        direction === 'in'
          ? await payrollApi.clockIn({ shift })
          : await payrollApi.clockOut({});
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const todayKey = new Date().toDateString();
  const today = attendance.find((row) => new Date(row.date).toDateString() === todayKey);

  return (
    <div>
      <PageHeader
        title="My pay & attendance"
        description={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()}
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

      {planned.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="This week's plan" description="Published roster — what you are expected to work." />
          <div className="flex flex-wrap gap-2">
            {planned.map((row) => (
              <Badge key={row._id} tone="info">
                {formatDate(row.date)} · {SHIFT_OPTIONS.find((s) => s.value === row.shift)?.label ?? row.shift}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader
          title="Today"
          description={
            today?.checkOutAt
              ? `Clocked out at ${time(today.checkOutAt)} — ${today.hoursWorked} hour(s)`
              : today?.checkInAt
                ? `Clocked in at ${time(today.checkInAt)}`
                : 'Not clocked in yet.'
          }
        />
        <div className="flex flex-wrap items-end gap-3">
          {!today?.checkInAt && (
            <div className="w-40">
              <Select
                label="Shift"
                options={SHIFT_OPTIONS}
                value={shift}
                onChange={(event) => setShift(event.target.value)}
              />
            </div>
          )}
          <Button
            loading={busy}
            disabled={Boolean(today?.checkInAt)}
            onClick={() => clock('in')}
          >
            Clock in
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            disabled={!today?.checkInAt || Boolean(today?.checkOutAt)}
            onClick={() => clock('out')}
          >
            Clock out
          </Button>
        </div>
      </Card>

      <CardHeader
        title="Payslips"
        description={
          pendingRuns > 0
            ? `${pendingRuns} run(s) still being prepared — those figures appear once approved.`
            : 'Issued payslips only.'
        }
      />

      {loading ? (
        <Spinner label="Loading…" className="py-10" />
      ) : payslips.length === 0 ? (
        <Card className="mb-6">
          <p className="py-6 text-center text-sm text-slate-500">
            No payslips have been issued to you yet.
          </p>
        </Card>
      ) : (
        <div className="mb-6 space-y-2">
          {payslips.map((slip) => (
            <Card key={slip._id} className="!p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{periodLabel(slip.period)}</p>
                  <p className="font-mono text-xs text-slate-400">
                    {slip.payslipNumber} · {slip.payableDays}/{slip.expectedWorkingDays} days
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-lg font-semibold text-slate-900">{slip.net}</p>
                    <p className="text-xs text-slate-500">net</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setOpenSlip(openSlip === slip._id ? null : slip._id)}
                  >
                    {openSlip === slip._id ? 'Hide' : 'Breakdown'}
                  </Button>
                </div>
              </div>

              {openSlip === slip._id && (
                <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">
                      Basic (pro-rated from {slip.basicSalary})
                    </dt>
                    <dd>{slip.proratedBasic}</dd>
                  </div>
                  {slip.overtimeHours > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Overtime ({slip.overtimeHours}h)</dt>
                      <dd>{slip.overtimePay}</dd>
                    </div>
                  )}
                  {(slip.allowances ?? []).map((line) => (
                    <div key={line.label} className="flex justify-between">
                      <dt className="text-slate-500">
                        {line.label}
                        {line.percentOfBasic ? ` (${line.percentOfBasic}%)` : ''}
                      </dt>
                      <dd>{line.amount}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-100 pt-1 font-medium">
                    <dt>Gross</dt>
                    <dd>{slip.gross}</dd>
                  </div>
                  {(slip.deductions ?? []).map((line) => (
                    <div key={line.label} className="flex justify-between text-rose-600">
                      <dt>
                        {line.label}
                        {line.percentOfBasic ? ` (${line.percentOfBasic}%)` : ''}
                      </dt>
                      <dd>−{line.amount}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
                    <dt>Net pay</dt>
                    <dd>{slip.net}</dd>
                  </div>
                </dl>
              )}
            </Card>
          ))}
        </div>
      )}

      <CardHeader
        title="Attendance"
        action={
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value || currentPeriod())}
            aria-label="Attendance period"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        }
      />

      {summary && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <StatCard label="Payable days" value={summary.payableDays} />
          <StatCard label="Present" value={summary.daysPresent} tone="emerald" />
          <StatCard label="Absent" value={summary.daysAbsent} tone="amber" />
          <StatCard label="Overtime" value={`${summary.overtimeHours}h`} tone="slate" />
        </div>
      )}

      <Table>
        <THead columns={ATTENDANCE_COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={ATTENDANCE_COLUMNS.length}>Loading…</TRMessage>}
          {!loading && attendance.length === 0 && (
            <TRMessage colSpan={ATTENDANCE_COLUMNS.length}>
              Nothing recorded for {periodLabel(period)}.
            </TRMessage>
          )}
          {!loading &&
            attendance.map((row) => (
              <TR key={row._id}>
                <TD>{formatDate(row.date)}</TD>
                <TD className="capitalize">{row.shift}</TD>
                <TD>{time(row.checkInAt)}</TD>
                <TD>{time(row.checkOutAt)}</TD>
                <TD>
                  {row.hoursWorked || '—'}
                  {row.overtimeHours > 0 && (
                    <span className="ml-1 text-xs text-amber-600">+{row.overtimeHours} OT</span>
                  )}
                </TD>
                <TD>
                  <Badge tone={ATTENDANCE_STATUS_TONES[row.status] ?? 'neutral'}>{row.status}</Badge>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>
    </div>
  );
}

export default PayslipPage;
