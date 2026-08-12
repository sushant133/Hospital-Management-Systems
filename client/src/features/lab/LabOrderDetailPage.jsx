import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  labApi, LAB_STATUS_TONES, PRIORITY_TONES, FLAG_TONES, FLAG_LABELS, nextAction,
} from './labApi.js';
import ResultEntryForm from './ResultEntryForm.jsx';
import { useAuth } from '../../app/AuthContext.jsx';
import { MODULES } from '../../app/permissions.js';
import { formatDate, fullName, ageFrom, titleCase } from '../../lib/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, DataRow, Input, Modal, PageHeader, Spinner,
} from '../../components/ui/index.js';

export function LabOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const isBench = can(MODULES.LAB_RESULTS, 'create');
  const canCollect = can(MODULES.LAB_ORDERS, 'collect');
  const canCancel = can(MODULES.LAB_ORDERS, 'cancel');

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [collectOpen, setCollectOpen] = useState(false);
  const [sampleId, setSampleId] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await labApi.getOrder(id);
      setOrder(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (fn, successMessage) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fn();
      setNotice(successMessage ?? response?.message ?? 'Done');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading lab order…" className="py-20" />;

  if (error && !order) {
    return (
      <div>
        <Alert tone="error" title="Could not load order">{error}</Alert>
        <Link to="/lab" className="mt-4 inline-block text-sm text-brand-600">← Back to laboratory</Link>
      </div>
    );
  }
  if (!order) return null;

  const patient = order.patientId ?? {};
  const age = ageFrom(patient.dateOfBirth);
  const next = nextAction(order.status);
  const resultsByTest = new Map((order.results ?? []).map((r) => [String(r.labTestId), r]));
  const isClosed = ['completed', 'cancelled'].includes(order.status);
  const hasCritical = (order.results ?? []).some((r) => r.hasCriticalValues);

  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/lab" className="hover:text-slate-700">← Laboratory</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.orderNumber}</span>
            <Badge tone={LAB_STATUS_TONES[order.status] ?? 'neutral'}>{order.status}</Badge>
            <Badge tone={PRIORITY_TONES[order.priority] ?? 'neutral'}>
              {order.priority === 'stat' ? 'STAT' : order.priority}
            </Badge>
          </span>
        }
        description={`${fullName(patient)} · ${patient.mrn ?? '—'} · ${age !== null ? `${age} yrs` : '—'} ${titleCase(patient.gender)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {order.reportPath && (
              <a href={labApi.reportUrl(order._id)} target="_blank" rel="noreferrer">
                <Button variant="secondary">📄 View report</Button>
              </a>
            )}
            {isBench && order.status === 'completed' && (
              <Button
                variant="ghost"
                loading={busy}
                onClick={() => runAction(() => labApi.regenerateReport(order._id), 'Report regenerated')}
              >
                Regenerate
              </Button>
            )}
            {canCollect && next?.action === 'collect' && (
              <Button onClick={() => setCollectOpen(true)}>{next.label}</Button>
            )}
            {isBench && next?.action === 'start' && (
              <Button loading={busy} onClick={() => runAction(() => labApi.start(order._id))}>
                {next.label}
              </Button>
            )}
            {canCancel && !isClosed && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel order
              </Button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {hasCritical && (
        <Alert tone="error" title="Critical values present" className="mb-4">
          One or more results are outside critical limits. Notify the requesting clinician
          immediately.
        </Alert>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Request" />
          <dl className="divide-y divide-slate-100">
            <DataRow label="Ordered by" value={fullName(order.orderedBy)} />
            <DataRow label="Ordered at" value={formatDate(order.createdAt, { withTime: true })} />
            <DataRow label="Visit" value={order.encounterId?.encounterNumber} />
            <DataRow label="Clinical notes" value={order.clinicalNotes || '—'} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Specimen" />
          <dl className="divide-y divide-slate-100">
            <DataRow label="Sample ID" value={order.sampleId || '—'} />
            <DataRow label="Collected at" value={order.collectedAt ? formatDate(order.collectedAt, { withTime: true }) : 'Not collected'} />
            <DataRow label="Collected by" value={order.collectedBy ? fullName(order.collectedBy) : '—'} />
            <DataRow label="Completed at" value={order.completedAt ? formatDate(order.completedAt, { withTime: true }) : '—'} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Billing" description="Charged to the visit at order time" />
          <dl className="divide-y divide-slate-100">
            <DataRow label="Order total" value={`${order.totalPrice}`} />
            <DataRow label="Tests" value={order.tests?.length ?? 0} />
            <DataRow
              label="Report"
              value={
                order.reportGeneratedAt
                  ? formatDate(order.reportGeneratedAt, { withTime: true })
                  : 'Not generated yet'
              }
            />
          </dl>
        </Card>
      </div>

      {order.status === 'cancelled' && (
        <Alert tone="warning" title="Order cancelled" className="mb-6">
          {order.cancellationReason || 'No reason recorded.'} Unbilled charges were reversed.
        </Alert>
      )}

      {/* Result entry / display, one card per ordered test */}
      <div className="space-y-4">
        {order.status === 'ordered' && (
          <Alert tone="info">
            Results can be entered once the specimen has been marked as collected.
          </Alert>
        )}

        {(order.catalogue ?? []).map((test) => {
          const existing = resultsByTest.get(String(test._id));

          // Bench staff get the entry form; everyone else a read-only view.
          if (isBench && order.status !== 'cancelled' && order.status !== 'ordered') {
            return (
              <ResultEntryForm
                key={test._id}
                orderId={order._id}
                test={test}
                existing={existing}
                onSaved={load}
              />
            );
          }

          return (
            <Card key={test._id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {test.name}
                    <Badge tone="info">{test.code}</Badge>
                    {existing && (
                      <Badge tone={existing.status === 'preliminary' ? 'warning' : 'success'}>
                        {existing.status}
                      </Badge>
                    )}
                  </span>
                }
              />
              {!existing ? (
                <p className="py-3 text-sm text-slate-500">No results entered yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Analyte</th>
                        <th className="py-2 pr-3 font-semibold">Result</th>
                        <th className="py-2 pr-3 font-semibold">Unit</th>
                        <th className="py-2 pr-3 font-semibold">Reference</th>
                        <th className="py-2 font-semibold">Flag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {existing.values.map((value) => (
                        <tr key={value.analyteCode}>
                          <td className="py-2 pr-3 text-slate-900">{value.analyteName}</td>
                          <td className={`py-2 pr-3 font-medium ${value.flag !== 'normal' ? 'text-amber-700' : 'text-slate-900'}`}>
                            {value.value}
                          </td>
                          <td className="py-2 pr-3 text-slate-500">{value.unit || '—'}</td>
                          <td className="py-2 pr-3 text-slate-500">{value.referenceRange || '—'}</td>
                          <td className="py-2">
                            <Badge tone={FLAG_TONES[value.flag] ?? 'neutral'}>
                              {FLAG_LABELS[value.flag]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {existing.interpretation && (
                    <p className="mt-3 text-sm text-slate-600">
                      <span className="font-medium text-slate-800">Interpretation: </span>
                      {existing.interpretation}
                    </p>
                  )}
                  {existing.verifiedBy && (
                    <p className="mt-2 text-xs text-slate-400">
                      Verified by {fullName(existing.verifiedBy)} ·{' '}
                      {formatDate(existing.verifiedAt, { withTime: true })}
                    </p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Modal
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        title="Mark specimen collected"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCollectOpen(false)}>Cancel</Button>
            <Button
              loading={busy}
              onClick={async () => {
                await runAction(() => labApi.collect(order._id, sampleId ? { sampleId } : {}));
                setCollectOpen(false);
                setSampleId('');
              }}
            >
              Confirm collection
            </Button>
          </>
        }
      >
        <Input
          label="Sample / specimen ID"
          value={sampleId}
          onChange={(event) => setSampleId(event.target.value)}
          placeholder="SPEC-0001"
          hint="Optional — the barcode or tube label."
        />
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this lab order?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep order</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                await runAction(() => labApi.cancel(order._id, { reason: cancelReason }));
                setCancelOpen(false);
                setCancelReason('');
              }}
            >
              Cancel order
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Unbilled charges for this order will be reversed. Charges already pulled onto an invoice
          need a credit note instead.
        </p>
        <Input
          label="Reason"
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder="e.g. Ordered in error"
        />
      </Modal>
    </div>
  );
}

export default LabOrderDetailPage;
