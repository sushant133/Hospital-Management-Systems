import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  radiologyApi,
  RAD_STATUS_OPTIONS,
  RAD_PRIORITY_OPTIONS,
  MODALITY_OPTIONS,
  RAD_STATUS_TONES,
  PRIORITY_TONES,
  MODALITY_LABELS,
} from '../../../api/radiologyApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, PageHeader, Pagination, Select,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'order', label: 'Order' },
  { key: 'patient', label: 'Patient' },
  { key: 'exam', label: 'Exam' },
  { key: 'priority', label: 'Priority' },
  { key: 'when', label: 'When' },
  { key: 'status', label: 'Status' },
];

export function RadiologyWorklistPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const isDesk = can(MODULES.RADIOLOGY_RESULTS, 'create');

  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [modality, setModality] = useState('');
  const [pendingOnly, setPendingOnly] = useState(isDesk);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await radiologyApi.listOrders({
        page,
        limit: 20,
        status: status || undefined,
        priority: priority || undefined,
        modality: modality || undefined,
        pendingOnly: pendingOnly ? 'true' : undefined,
        sort: '-createdAt',
      });
      setOrders(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, priority, modality, pendingOnly]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Radiology"
        description={
          isDesk
            ? 'Imaging queue — schedule studies, acquire, and report.'
            : 'Imaging orders raised across the hospital.'
        }
        action={
          can(MODULES.RADIOLOGY_EXAMS, 'edit') && (
            <Button variant="secondary" onClick={() => navigate('/radiology/catalog')}>
              Exam catalogue
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          options={[{ value: '', label: 'Any' }, ...RAD_STATUS_OPTIONS]}
          className="w-40"
        />
        <Select
          label="Priority"
          value={priority}
          onChange={(e) => { setPriority(e.target.value); setPage(1); }}
          options={[{ value: '', label: 'Any' }, ...RAD_PRIORITY_OPTIONS]}
          className="w-36"
        />
        <Select
          label="Modality"
          value={modality}
          onChange={(e) => { setModality(e.target.value); setPage(1); }}
          options={[{ value: '', label: 'Any' }, ...MODALITY_OPTIONS]}
          className="w-44"
        />
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); }}
          />
          Pending only
        </label>
      </div>

      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading worklist…</TRMessage>}
          {!loading && orders.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No imaging orders match.</TRMessage>
          )}
          {!loading &&
            orders.map((order) => (
              <TR key={order._id} onClick={() => navigate(`/radiology/orders/${order._id}`)}>
                <TD>
                  <Link
                    to={`/radiology/orders/${order._id}`}
                    className="font-mono text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    {order.orderNumber}
                  </Link>
                </TD>
                <TD>
                  <div className="font-medium text-slate-900">{fullName(order.patientId)}</div>
                  <div className="text-xs text-slate-400">{order.patientId?.mrn}</div>
                </TD>
                <TD>
                  <div className="text-sm text-slate-900">{order.name}</div>
                  <div className="text-xs text-slate-400">
                    {MODALITY_LABELS[order.modality] ?? order.modality} · {order.bodyPart}
                  </div>
                </TD>
                <TD>
                  <Badge tone={PRIORITY_TONES[order.priority] ?? 'neutral'}>
                    {order.priority === 'stat' ? 'STAT' : order.priority}
                  </Badge>
                </TD>
                <TD className="text-slate-500">
                  {order.scheduledFor
                    ? formatDate(order.scheduledFor, { withTime: true })
                    : formatDate(order.createdAt, { withTime: true })}
                </TD>
                <TD>
                  <Badge tone={RAD_STATUS_TONES[order.status] ?? 'neutral'}>{order.status}</Badge>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />
    </div>
  );
}

export default RadiologyWorklistPage;
