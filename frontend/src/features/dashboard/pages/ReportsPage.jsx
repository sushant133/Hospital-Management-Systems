import { useCallback, useEffect, useMemo, useState } from 'react';
import { reportApi, csvUrl, lastDays, REPORT_TABS } from '../../../api/reportApi.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, titleCase } from '../../../utils/format.js';
import RangePicker from '../components/RangePicker.jsx';
import MiniBars from '../components/MiniBars.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Spinner, StatCard,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

/** Column sets per tab — also the CSV shape, so the two never drift apart. */
const COLUMNS = {
  revenue: [
    { key: 'bucket', label: 'Period' },
    { key: 'billed', label: 'Billed', align: 'right' },
    { key: 'collected', label: 'Collected', align: 'right' },
    { key: 'invoices', label: 'Invoices', align: 'right' },
    { key: 'receipts', label: 'Receipts', align: 'right' },
  ],
  occupancy: [
    { key: 'ward', label: 'Ward' },
    { key: 'total', label: 'Beds', align: 'right' },
    { key: 'occupied', label: 'Occupied', align: 'right' },
    { key: 'available', label: 'Available', align: 'right' },
    { key: 'unavailable', label: 'Out of service', align: 'right' },
    { key: 'occupancyRate', label: 'Occupancy', align: 'right' },
    { key: 'averageStayDays', label: 'Avg stay', align: 'right' },
  ],
  departments: [
    { key: 'department', label: 'Department' },
    { key: 'visits', label: 'Visits', align: 'right' },
    { key: 'uniquePatients', label: 'Patients', align: 'right' },
    { key: 'admissions', label: 'Admissions', align: 'right' },
    { key: 'noShowRate', label: 'No-show', align: 'right' },
    { key: 'revenue', label: 'Charges', align: 'right' },
    { key: 'revenuePerBed', label: 'Per bed', align: 'right' },
  ],
  inventory: [
    { key: 'item', label: 'Item' },
    { key: 'issued', label: 'Issued', align: 'right' },
    { key: 'value', label: 'Value', align: 'right' },
    { key: 'movements', label: 'Movements', align: 'right' },
  ],
  clinical: [
    { key: 'service', label: 'Service' },
    { key: 'priority', label: 'Priority' },
    { key: 'completed', label: 'Completed', align: 'right' },
    { key: 'averageHours', label: 'Avg hours', align: 'right' },
    { key: 'slowestHours', label: 'Slowest', align: 'right' },
  ],
  attendance: [
    { key: 'name', label: 'Staff' },
    { key: 'department', label: 'Department' },
    { key: 'present', label: 'Present', align: 'right' },
    { key: 'absent', label: 'Absent', align: 'right' },
    { key: 'payableDays', label: 'Payable', align: 'right' },
    { key: 'hours', label: 'Hours', align: 'right' },
    { key: 'overtime', label: 'Overtime', align: 'right' },
    { key: 'approvedPercent', label: 'Approved', align: 'right' },
  ],
};

const PERCENT_KEYS = new Set(['occupancyRate', 'noShowRate', 'approvedPercent']);
const HOUR_KEYS = new Set(['averageHours', 'slowestHours', 'hours', 'overtime']);
const LABEL_KEYS = new Set(['service', 'priority']);

/** Units live here rather than in the payload, so the CSV stays plain numbers. */
const cell = (row, column) => {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '—';
  if (PERCENT_KEYS.has(column.key)) return `${value}%`;
  if (column.key === 'averageStayDays') return `${value}d`;
  if (HOUR_KEYS.has(column.key)) return `${value}h`;
  if (LABEL_KEYS.has(column.key)) return titleCase(value);
  return value;
};

/**
 * The reports workspace.
 *
 * Tabs are filtered by the same grants that gate the endpoints, so a tab is only
 * ever shown when the request behind it would succeed — an accountant sees money
 * and activity, a doctor sees activity and diagnostics, and neither sees the
 * other's. A role holding none of them never reaches this page at all.
 */
export function ReportsPage() {
  const { can } = usePermissions();

  const tabs = useMemo(
    () => REPORT_TABS.filter((tab) => can(tab.module, tab.action)),
    [can],
  );

  const [tab, setTab] = useState(() => tabs[0]?.key ?? null);
  const [range, setRange] = useState(() => lastDays(30));
  const [groupBy, setGroupBy] = useState('day');

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const canExport = can(MODULES.REPORTS, 'export');

  const load = useCallback(async () => {
    if (!tab) return;
    setLoading(true);
    setError(null);
    try {
      const params = { ...range, ...(tab === 'revenue' ? { groupBy } : {}) };
      setReport(await reportApi[tab](params));
    } catch (err) {
      setError(err.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [tab, range, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  if (tabs.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="No reports available to your role"
        description="Reporting is split into operational, financial and clinical grants. Yours includes none of them."
      />
    );
  }

  const columns = COLUMNS[tab] ?? [];
  const rows = report?.data ?? [];
  const meta = report?.meta ?? {};
  const totals = meta.totals ?? {};

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Aggregations over what the hospital recorded. Every figure is derived at read time — nothing here is stored or edited."
      />

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-6" role="tablist">
          {tabs.map((item) => (
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

      <RangePicker range={range} onChange={setRange}>
        {tab === 'revenue' && (
          <div className="w-32">
            <Select
              label="Group by"
              options={[
                { value: 'day', label: 'Day' },
                { value: 'month', label: 'Month' },
              ]}
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
            />
          </div>
        )}
        {/* Only offered to roles holding `reports.export` — otherwise the
            download would navigate straight into a 403 page. */}
        {canExport && (
          <a
            href={csvUrl(tab, { ...range, ...(tab === 'revenue' ? { groupBy } : {}) })}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⬇ Export CSV
          </a>
        )}
      </RangePicker>

      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Spinner label="Building the report…" className="py-16" />
      ) : (
        <>
          {/* --- headline figures, per tab --- */}
          {tab === 'revenue' && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Billed" value={totals.billed ?? 0} hint="Invoiced in this range" />
                <StatCard label="Collected" value={totals.collected ?? 0} tone="emerald" hint="Net of refunds" />
                <StatCard label="Outstanding" value={totals.outstanding ?? 0} tone="amber" hint="Still owed on these bills" />
                <StatCard label="Invoices" value={totals.invoices ?? 0} tone="slate" />
              </div>

              <Card className="mb-4">
                <CardHeader
                  title="Billed against collected"
                  description="They diverge whenever a bill is unpaid — one is what was charged, the other is money that arrived."
                />
                <MiniBars
                  series={rows}
                  keys={[
                    { key: 'billed', label: 'Billed', className: 'fill-brand-400', swatch: 'bg-brand-400' },
                    { key: 'collected', label: 'Collected', className: 'fill-emerald-500', swatch: 'bg-emerald-500' },
                  ]}
                />
              </Card>

              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="By department" description="Attributed to the department that raised each charge." />
                  {(meta.byDepartment ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">Nothing invoiced.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {meta.byDepartment.map((row) => (
                        <li key={String(row.departmentId ?? 'none')} className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{row.department}</p>
                            <p className="text-xs text-slate-500">{row.lines} charge(s)</p>
                          </div>
                          <span className="font-semibold text-slate-900">{row.amount}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <CardHeader title="By payer" description="What insurers agreed against what patients owe." />
                  <div className="mb-3 flex gap-3">
                    <div className="flex-1 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Insurer</p>
                      <p className="text-lg font-semibold">{meta.byPayer?.insurer ?? 0}</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Patient</p>
                      <p className="text-lg font-semibold">{meta.byPayer?.patient ?? 0}</p>
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {(meta.byPayer?.byInsurer ?? []).map((row) => (
                      <li key={String(row.providerId)} className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{row.provider}</p>
                          <p className="text-xs text-slate-500">{row.claims} claim(s) settled</p>
                        </div>
                        <span className="font-semibold">{row.settled}</span>
                      </li>
                    ))}
                    {(meta.byPayer?.byInsurer ?? []).length === 0 && (
                      <li className="py-2 text-sm text-slate-500">No claims settled in this range.</li>
                    )}
                  </ul>
                </Card>
              </div>
            </>
          )}

          {tab === 'occupancy' && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Occupancy" value={`${totals.occupancyRate ?? 0}%`} />
              <StatCard label="Occupied" value={`${totals.occupied ?? 0} / ${totals.total ?? 0}`} tone="amber" />
              <StatCard label="Out of service" value={totals.unavailable ?? 0} tone="slate" hint="Cleaning or maintenance" />
              <StatCard label="Avg stay" value={`${totals.averageStayDays ?? 0}d`} tone="emerald" hint="Discharged stays only" />
              <StatCard label="In a bed now" value={totals.currentStays ?? 0} tone="slate" />
            </div>
          )}

          {tab === 'departments' && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Visits" value={totals.visits ?? 0} />
              <StatCard label="Admissions" value={totals.admissions ?? 0} tone="amber" />
              <StatCard label="Charges raised" value={totals.revenue ?? 0} tone="emerald" hint="Billed or not" />
              <StatCard label="No-shows" value={totals.noShow ?? 0} tone="slate" hint={`of ${totals.booked ?? 0} booked`} />
            </div>
          )}

          {tab === 'inventory' && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Consumed" value={totals.burnValue ?? 0} hint={`${totals.itemsIssued ?? 0} units issued`} />
                <StatCard label="Stock on hand" value={totals.stockValue ?? 0} tone="emerald" />
                <StatCard
                  label="Expiry exposure"
                  value={totals.expiryExposure ?? 0}
                  tone="amber"
                  hint={`Within ${meta.expiryDays ?? 90} days`}
                />
                <StatCard label="Below reorder" value={totals.lowStockCount ?? 0} tone="slate" />
              </div>

              {totals.alreadyExpired > 0 && (
                <Alert tone="warning" title="Already expired" className="mb-4">
                  {totals.alreadyExpired} of stock is past its expiry date and still counted as on hand.
                </Alert>
              )}

              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Expiring batches" description="Valued at cost — three vials and three boxes are different problems." />
                  {(meta.expiring ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">Nothing expiring in this window.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {meta.expiring.slice(0, 10).map((row) => (
                        <li key={String(row.batchId)} className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{row.drug}</p>
                            <p className="text-xs text-slate-500">
                              {row.batchNo} · {row.quantityOnHand} left · {formatDate(row.expiryDate)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{row.value}</p>
                            {row.expired && <Badge tone="danger">expired</Badge>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Below reorder level" />
                  {(meta.lowStock ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">Everything is above its reorder level.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {meta.lowStock.slice(0, 10).map((row) => (
                        <li key={String(row.itemId)} className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{row.item}</p>
                            <p className="text-xs text-slate-500">{row.itemCode} · {row.category}</p>
                          </div>
                          <span className="text-sm">
                            {row.quantityOnHand} / {row.reorderLevel} {row.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}

          {tab === 'clinical' && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Completed" value={totals.completed ?? 0} />
                <StatCard label="Avg turnaround" value={`${totals.averageHours ?? 0}h`} tone="emerald" />
                <StatCard label="Lab pending" value={totals.labPending ?? 0} tone="amber" />
                <StatCard label="Imaging pending" value={totals.radiologyPending ?? 0} tone="amber" />
              </div>

              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Discharge outcomes" />
                  <ul className="divide-y divide-slate-100">
                    {(meta.dischargeOutcomes ?? []).map((row) => (
                      <li key={row.outcome} className="flex justify-between py-2 text-sm">
                        <span className="capitalize">{row.outcome}</span>
                        <span className="font-semibold">{row.count}</span>
                      </li>
                    ))}
                    {(meta.dischargeOutcomes ?? []).length === 0 && (
                      <li className="py-2 text-sm text-slate-500">No discharges in this range.</li>
                    )}
                  </ul>
                </Card>

                <Card>
                  <CardHeader title="Most common primary diagnoses" />
                  <ul className="divide-y divide-slate-100">
                    {(meta.topDiagnoses ?? []).map((row) => (
                      <li key={row.diagnosis} className="flex justify-between py-2 text-sm">
                        <span>{row.diagnosis}</span>
                        <span className="font-semibold">{row.count}</span>
                      </li>
                    ))}
                    {(meta.topDiagnoses ?? []).length === 0 && (
                      <li className="py-2 text-sm text-slate-500">No diagnoses recorded in this range.</li>
                    )}
                  </ul>
                </Card>
              </div>
            </>
          )}

          {tab === 'attendance' && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Staff with records" value={totals.staff ?? 0} />
              <StatCard label="Hours worked" value={totals.hours ?? 0} tone="emerald" />
              <StatCard
                label="Overtime"
                value={`${totals.overtime ?? 0}h`}
                tone="amber"
                hint={`${totals.overtimeShare ?? 0}% of all hours`}
              />
              <StatCard label="Absences" value={totals.absent ?? 0} tone="slate" />
            </div>
          )}

          {/* --- the table, identical in shape to the CSV --- */}
          <Table>
            <THead columns={columns} />
            <TBody>
              {rows.length === 0 && (
                <TRMessage colSpan={columns.length}>Nothing recorded in this range.</TRMessage>
              )}
              {rows.map((row, index) => (
                <TR key={String(row._id ?? row.bucket ?? row.userId ?? row.departmentId ?? index)}>
                  {columns.map((column) => (
                    <TD key={column.key} align={column.align}>
                      {cell(row, column)}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}

export default ReportsPage;
