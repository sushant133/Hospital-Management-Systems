import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  labApi, LAB_STATUS_OPTIONS, LAB_PRIORITY_OPTIONS, LAB_STATUS_TONES, PRIORITY_TONES,
} from '../../../api/labApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Modal, PageHeader, Pagination, Select, Textarea,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'order', label: 'Order' },
  { key: 'patient', label: 'Patient' },
  { key: 'tests', label: 'Tests' },
  { key: 'priority', label: 'Priority' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'status', label: 'Status' },
];

export function LabWorklistPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const isBench = can(MODULES.LAB_RESULTS, 'create');

  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  // Bench staff care about the queue; everyone else about recent history.
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [pendingOnly, setPendingOnly] = useState(isBench);
  const [hl7Open, setHl7Open] = useState(false);
  const [hl7Text, setHl7Text] = useState('');
  const [hl7Busy, setHl7Busy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await labApi.listOrders({
        page,
        limit: 20,
        status: status || undefined,
        priority: priority || undefined,
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
  }, [page, status, priority, pendingOnly]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Laboratory"
        description={
          isBench
            ? 'Specimen queue — collect samples, process orders and enter results.'
            : 'Lab orders raised across the hospital.'
        }
        action={
          <div className="flex gap-2">
            {isBench && (
              <Button variant="secondary" onClick={() => { setHl7Text(''); setHl7Open(true); }}>
                Ingest HL7
              </Button>
            )}
            {can(MODULES.LAB_TESTS, 'edit') && (
              <Button variant="secondary" onClick={() => navigate('/lab/catalog')}>
                Test catalogue
              </Button>
            )}
          </div>
        }
      />

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(event) => {
              setPendingOnly(event.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Pending only
        </label>

        <div className="w-44">
          <Select
            options={LAB_STATUS_OPTIONS}
            placeholder="All statuses"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          />
        </div>

        <div className="w-40">
          <Select
            options={LAB_PRIORITY_OPTIONS}
            placeholder="All priorities"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by priority"
          />
        </div>
      </div>

      {error && (
        <Alert tone="error" title="Could not load lab orders" className="mb-4">
          {error}
        </Alert>
      )}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading orders…</TRMessage>}
          {!loading && orders.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>
              {pendingOnly ? 'Nothing in the queue — all caught up.' : 'No lab orders found.'}
            </TRMessage>
          )}
          {!loading &&
            orders.map((order) => (
              <TR key={order._id} onClick={() => navigate(`/lab/orders/${order._id}`)}>
                <TD>
                  <Link
                    to={`/lab/orders/${order._id}`}
                    className="font-mono text-xs font-medium text-brand-600 hover:text-brand-700"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {order.orderNumber}
                  </Link>
                  {order.sampleId && (
                    <div className="text-xs text-slate-400">{order.sampleId}</div>
                  )}
                </TD>
                <TD>
                  <div className="font-medium text-slate-900">{fullName(order.patientId)}</div>
                  <div className="text-xs text-slate-400">
                    {order.patientId?.mrn} · {order.encounterId?.encounterNumber}
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {order.tests?.slice(0, 3).map((test) => (
                      <Badge key={test.code} tone="info">
                        {test.code}
                      </Badge>
                    ))}
                    {order.tests?.length > 3 && (
                      <Badge tone="neutral">+{order.tests.length - 3}</Badge>
                    )}
                  </div>
                </TD>
                <TD>
                  <Badge tone={PRIORITY_TONES[order.priority] ?? 'neutral'}>
                    {order.priority === 'stat' ? 'STAT' : order.priority}
                  </Badge>
                </TD>
                <TD>
                  <div className="text-sm">{formatDate(order.createdAt, { withTime: true })}</div>
                  <div className="text-xs text-slate-400">{fullName(order.orderedBy)}</div>
                </TD>
                <TD>
                  <Badge tone={LAB_STATUS_TONES[order.status] ?? 'neutral'}>{order.status}</Badge>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />

      <Modal
        open={hl7Open}
        onClose={() => setHl7Open(false)}
        title="Ingest HL7 ORU^R01"
        description="Paste a raw ORU message. The placer or filler order number must match an existing lab order (e.g. LAB-000001)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setHl7Open(false)}>Cancel</Button>
            <Button
              loading={hl7Busy}
              onClick={async () => {
                if (hl7Text.trim().length < 10) return setError('Paste a full HL7 message.');
                setHl7Busy(true);
                setError(null);
                try {
                  const response = await labApi.ingestHl7(hl7Text);
                  setNotice(response.message);
                  setHl7Open(false);
                  await load();
                } catch (err) {
                  setError(err.message);
                } finally {
                  setHl7Busy(false);
                }
              }}
            >
              Post result
            </Button>
          </>
        }
      >
        <Textarea
          rows={12}
          className="font-mono text-xs"
          value={hl7Text}
          onChange={(e) => setHl7Text(e.target.value)}
          placeholder={'MSH|^~\\&|ANALYZER|LAB|HMS|HOSP|202608151200||ORU^R01|MSG0001|P|2.3\nPID|||MRN||DOE^JANE\nOBR|1|LAB-000001||CBC^Complete Blood Count\nOBX|1|NM|HGB^Haemoglobin|1|13.2|g/dL|12-16|N'}
        />
      </Modal>
    </div>
  );
}

export default LabWorklistPage;
