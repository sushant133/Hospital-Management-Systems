import { useCallback, useEffect, useState } from 'react';
import {
  payrollApi,
  RUN_STATUS_OPTIONS,
  RUN_STATUS_TONES,
  runActions,
  currentPeriod,
  periodLabel,
} from '../../../api/payrollApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName, titleCase } from '../../../utils/format.js';
import SalaryStructureModal from '../components/SalaryStructureModal.jsx';
import RunActionModal from '../components/RunActionModal.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, Input, PageHeader, Select, Spinner, StatCard,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const RUN_COLUMNS = [
  { key: 'period', label: 'Period' },
  { key: 'staff', label: 'Payslips' },
  { key: 'gross', label: 'Gross' },
  { key: 'deductions', label: 'Deductions' },
  { key: 'net', label: 'Net' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '' },
];

const PAYSLIP_COLUMNS = [
  { key: 'staff', label: 'Staff' },
  { key: 'days', label: 'Days' },
  { key: 'basic', label: 'Basic (pro-rated)' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'gross', label: 'Gross' },
  { key: 'deductions', label: 'Deductions' },
  { key: 'net', label: 'Net' },
];

const STRUCTURE_COLUMNS = [
  { key: 'staff', label: 'Staff' },
  { key: 'basic', label: 'Basic' },
  { key: 'allowances', label: 'Allowances' },
  { key: 'deductions', label: 'Deductions' },
  { key: 'from', label: 'In force' },
];

const TABS = [
  { key: 'runs', label: 'Runs' },
  { key: 'structures', label: 'Salary structures' },
];

const ACTION_LABELS = {
  rebuild: 'Rebuild',
  approve: 'Approve',
  pay: 'Mark paid',
  cancel: 'Cancel',
};

/**
 * The payroll office: monthly runs, what each one totals, and the salary
 * structures behind them.
 *
 * Opening a run computes every payslip immediately from attendance, so the
 * figures are visible before anything is signed off — and a draft can be rebuilt
 * as many times as attendance is corrected.
 */
export function PayrollRunPage() {
  const { can } = usePermissions();
  const canCreate = can(MODULES.PAYROLL, 'create');
  const canEdit = can(MODULES.PAYROLL, 'edit');
  const canApprove = can(MODULES.PAYROLL, 'approve');

  const [tab, setTab] = useState('runs');
  const [status, setStatus] = useState('');

  const [runs, setRuns] = useState([]);
  const [structures, setStructures] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState(null);

  const [period, setPeriod] = useState(currentPeriod);
  const [workingDays, setWorkingDays] = useState('');
  const [multiplier, setMultiplier] = useState('1.5');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [structureModal, setStructureModal] = useState(false);
  const [runModal, setRunModal] = useState({ action: null, run: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'runs') {
        const response = await payrollApi.listRuns({ status: status || undefined, limit: 50 });
        setRuns(response.data);
      } else {
        const [structureList, directory] = await Promise.all([
          payrollApi.listStructures({ currentOnly: 'true', limit: 100 }),
          staffApi.directory({ limit: 200 }),
        ]);
        setStructures(structureList.data);
        setStaff(directory.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, status]);

  useEffect(() => {
    load();
  }, [load]);

  const openRun = async () => {
    setBusy(true);
    setError(null);
    setSkipped([]);
    try {
      const response = await payrollApi.createRun({
        period,
        expectedWorkingDays: workingDays ? Number(workingDays) : undefined,
        overtimeMultiplier: multiplier ? Number(multiplier) : undefined,
      });
      setNotice(response.message);
      setSkipped(response.meta?.skipped ?? []);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async (run) => {
    setBusy(true);
    setError(null);
    try {
      const response = await payrollApi.rebuildRun(run._id);
      setNotice(response.message);
      setSkipped(response.meta?.skipped ?? []);
      await load();
      if (selected?._id === run._id) await openDetail(run);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (run) => {
    setError(null);
    try {
      const response = await payrollApi.getRun(run._id);
      setSelected(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  const allowed = (run) =>
    runActions(run.status).filter((action) => {
      if (action === 'rebuild') return canEdit;
      return canApprove;
    });

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Monthly runs computed from the attendance register, and the salary structures behind them."
        action={
          tab === 'structures' && canEdit ? (
            <Button onClick={() => setStructureModal(true)}>Set salary</Button>
          ) : null
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
      {skipped.length > 0 && (
        <Alert tone="warning" title="Skipped staff" className="mb-4" onDismiss={() => setSkipped([])}>
          <ul className="list-inside list-disc text-sm">
            {skipped.map((row) => (
              <li key={String(row.userId)}>
                {row.name} — {row.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => { setTab(item.key); setSelected(null); }}
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

      {tab === 'runs' && (
        <>
          {canCreate && (
            <Card className="mb-4">
              <CardHeader
                title="Open a run"
                description="Every payslip is computed straight away from approved attendance. Nothing is paid until a second person approves it."
              />
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Input
                    label="Period"
                    type="month"
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  />
                </div>
                <div className="w-40">
                  <Input
                    label="Working days"
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Weekdays"
                    value={workingDays}
                    onChange={(event) => setWorkingDays(event.target.value)}
                  />
                </div>
                <div className="w-40">
                  <Input
                    label="Overtime ×"
                    type="number"
                    min="1"
                    max="4"
                    step="0.1"
                    value={multiplier}
                    onChange={(event) => setMultiplier(event.target.value)}
                  />
                </div>
                <Button loading={busy} onClick={openRun}>Open run</Button>
              </div>
            </Card>
          )}

          <div className="mb-4 w-52">
            <Select
              options={RUN_STATUS_OPTIONS}
              placeholder="Any status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter by status"
            />
          </div>

          <Table>
            <THead columns={RUN_COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={RUN_COLUMNS.length}>Loading runs…</TRMessage>}
              {!loading && runs.length === 0 && (
                <TRMessage colSpan={RUN_COLUMNS.length}>No payroll runs yet.</TRMessage>
              )}
              {!loading &&
                runs.map((run) => (
                  <TR key={run._id}>
                    <TD>
                      <button
                        type="button"
                        onClick={() => openDetail(run)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {periodLabel(run.period)}
                      </button>
                      <div className="text-xs text-slate-400">
                        {run.expectedWorkingDays} working days · OT ×{run.overtimeMultiplier}
                      </div>
                    </TD>
                    <TD>{run.payslipCount}</TD>
                    <TD>{run.totalGross}</TD>
                    <TD>{run.totalDeductions}</TD>
                    <TD className="font-semibold">{run.totalNet}</TD>
                    <TD>
                      <Badge tone={RUN_STATUS_TONES[run.status] ?? 'neutral'}>{run.status}</Badge>
                      {run.approvedBy && (
                        <div className="text-xs text-slate-400">
                          by {fullName(run.approvedBy)}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1">
                        {allowed(run).map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === 'approve' ? 'primary' : 'secondary'}
                            loading={busy}
                            onClick={() =>
                              action === 'rebuild'
                                ? rebuild(run)
                                : setRunModal({ action, run })
                            }
                          >
                            {ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>

          {selected && (
            <div className="mt-6">
              <CardHeader
                title={`${periodLabel(selected.period)} — payslips`}
                description={
                  selected.builtAt
                    ? `Built ${formatDate(selected.builtAt, { withTime: true })}${
                        selected.builtBy ? ` by ${fullName(selected.builtBy)}` : ''
                      }`
                    : undefined
                }
              />

              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <StatCard label="Gross" value={selected.totalGross} />
                <StatCard label="Deductions" value={selected.totalDeductions} />
                <StatCard label="Net" value={selected.totalNet} tone="emerald" />
              </div>

              <Table>
                <THead columns={PAYSLIP_COLUMNS} />
                <TBody>
                  {(selected.payslips ?? []).length === 0 && (
                    <TRMessage colSpan={PAYSLIP_COLUMNS.length}>
                      No payslips — nobody has a salary structure in force for this period.
                    </TRMessage>
                  )}
                  {(selected.payslips ?? []).map((slip) => (
                    <TR key={slip._id}>
                      <TD>
                        <div className="font-medium text-slate-900">{slip.staffName}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {slip.payslipNumber} · {titleCase(slip.staffRole)}
                        </div>
                      </TD>
                      <TD>
                        <span className="text-sm">
                          {slip.payableDays} / {slip.expectedWorkingDays}
                        </span>
                        {slip.daysAbsent > 0 && (
                          <div className="text-xs text-rose-500">{slip.daysAbsent} absent</div>
                        )}
                      </TD>
                      <TD>{slip.proratedBasic}</TD>
                      <TD>
                        {slip.overtimeHours > 0 ? (
                          <>
                            <div className="text-sm">{slip.overtimePay}</div>
                            <div className="text-xs text-slate-400">{slip.overtimeHours}h</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TD>
                      <TD>{slip.gross}</TD>
                      <TD>{slip.totalDeductions}</TD>
                      <TD className="font-semibold">{slip.net}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </>
      )}

      {tab === 'structures' && (
        loading ? (
          <Spinner label="Loading salary structures…" className="py-10" />
        ) : (
          <>
            <Alert tone="info" className="mb-4">
              A pay change creates a new structure from a date rather than editing the old one, so a
              payslip issued last year can still be explained by the structure it was computed from.
            </Alert>
            <Table>
              <THead columns={STRUCTURE_COLUMNS} />
              <TBody>
                {structures.length === 0 && (
                  <TRMessage colSpan={STRUCTURE_COLUMNS.length}>
                    Nobody has a salary structure yet — payroll runs will skip everyone.
                  </TRMessage>
                )}
                {structures.map((structure) => (
                  <TR key={structure._id}>
                    <TD>
                      <div className="font-medium text-slate-900">{fullName(structure.userId)}</div>
                      <div className="text-xs text-slate-400">{titleCase(structure.userId?.role)}</div>
                    </TD>
                    <TD className="font-semibold">{structure.basicSalary}</TD>
                    <TD>
                      {(structure.allowances ?? []).length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <ul className="text-xs text-slate-600">
                          {structure.allowances.map((line) => (
                            <li key={line.label}>
                              {line.label}: {line.percentOfBasic ? `${line.percentOfBasic}%` : line.amount}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                    <TD>
                      {(structure.deductions ?? []).length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <ul className="text-xs text-slate-600">
                          {structure.deductions.map((line) => (
                            <li key={line.label}>
                              {line.label}: {line.percentOfBasic ? `${line.percentOfBasic}%` : line.amount}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                    <TD>
                      <span className="text-sm">from {formatDate(structure.effectiveFrom)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )
      )}

      <SalaryStructureModal
        open={structureModal}
        staff={staff}
        onClose={() => setStructureModal(false)}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />

      <RunActionModal
        action={runModal.action}
        run={runModal.run}
        onClose={() => setRunModal({ action: null, run: null })}
        onDone={(response) => {
          setNotice(response.message);
          setSelected(null);
          load();
        }}
      />
    </div>
  );
}

export default PayrollRunPage;
