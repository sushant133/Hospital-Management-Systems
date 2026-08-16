import { useCallback, useEffect, useState } from 'react';
import { auditApi, AUDIT_ACTION_OPTIONS, AUDIT_OUTCOME_OPTIONS } from '../../../api/auditApi.js';
import { formatDate } from '../../../utils/format.js';
import {
  Alert, Badge, Input, PageHeader, Pagination, Select,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'when', label: 'When' },
  { key: 'who', label: 'Who' },
  { key: 'action', label: 'Action' },
  { key: 'what', label: 'What' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'req', label: 'Request' },
];

export function AuditLogPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [module, setModule] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await auditApi.list({
        page,
        limit: 25,
        action: action || undefined,
        outcome: outcome || undefined,
        module: module.trim() || undefined,
        sort: '-createdAt',
      });
      setRows(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, action, outcome, module]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only trail of writes (and, if enabled, PHI reads). Entries cannot be edited or removed."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Action"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          options={AUDIT_ACTION_OPTIONS}
          className="w-44"
        />
        <Select
          label="Outcome"
          value={outcome}
          onChange={(e) => { setOutcome(e.target.value); setPage(1); }}
          options={AUDIT_OUTCOME_OPTIONS}
          className="w-40"
        />
        <Input
          label="Module"
          value={module}
          onChange={(e) => { setModule(e.target.value); setPage(1); }}
          placeholder="patients, auth, …"
          className="w-44"
        />
      </div>

      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading trail…</TRMessage>}
          {!loading && rows.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No matching entries.</TRMessage>
          )}
          {!loading &&
            rows.map((row) => (
              <TR key={row._id} onClick={() => setExpanded(expanded === row._id ? null : row._id)}>
                <TD className="whitespace-nowrap text-xs text-slate-500">
                  {formatDate(row.createdAt, { withTime: true })}
                </TD>
                <TD>
                  <div className="text-sm text-slate-900">{row.userName || '—'}</div>
                  <div className="text-xs text-slate-400">{row.userRole || ''}</div>
                </TD>
                <TD>
                  <Badge tone={row.action === 'login_failed' || row.outcome === 'failure' ? 'danger' : 'neutral'}>
                    {row.action}
                  </Badge>
                </TD>
                <TD>
                  <div className="text-sm text-slate-800">
                    {row.resourceType}
                    {row.resourceRef ? ` · ${row.resourceRef}` : ''}
                  </div>
                  <div className="text-xs text-slate-400">{row.module} · {row.method} {row.path}</div>
                  {expanded === row._id && row.reason && (
                    <p className="mt-1 text-xs text-slate-600">{row.reason}</p>
                  )}
                  {expanded === row._id && row.changes && (
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                      {JSON.stringify(row.changes, null, 2)}
                    </pre>
                  )}
                </TD>
                <TD>
                  <Badge tone={row.outcome === 'success' ? 'success' : 'danger'}>{row.outcome}</Badge>
                </TD>
                <TD className="font-mono text-[11px] text-slate-400">{row.requestId || '—'}</TD>
              </TR>
            ))}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />
    </div>
  );
}

export default AuditLogPage;
