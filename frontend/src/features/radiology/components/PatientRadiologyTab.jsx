import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  radiologyApi,
  RAD_STATUS_TONES,
  PRIORITY_TONES,
  MODALITY_LABELS,
} from '../../../api/radiologyApi.js';
import NewRadiologyOrderModal from './NewRadiologyOrderModal.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Spinner } from '../../../components/ui/index.js';

export function PatientRadiologyTab({ patient }) {
  const { can } = useAuth();
  const canOrder = can(MODULES.RADIOLOGY_ORDERS, 'create');
  const canView = can(MODULES.RADIOLOGY_ORDERS, 'view');

  const [orders, setOrders] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [orderOpen, setOrderOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orderRes, resultRes] = await Promise.all([
        radiologyApi.listOrders({ patientId: patient._id, limit: 25, sort: '-createdAt' }),
        radiologyApi.listResults({ patientId: patient._id, limit: 50, sort: '-createdAt' }),
      ]);
      setOrders(orderRes.data);
      setResults(resultRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [patient._id]);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [load, canView]);

  if (!canView) {
    return <Alert tone="info">Your role does not have access to radiology data.</Alert>;
  }

  if (loading) return <Spinner label="Loading imaging data…" className="py-16" />;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      <Card>
        <CardHeader
          title="Imaging orders"
          description="Requests raised for this patient"
          action={canOrder && (
            <Button size="sm" onClick={() => setOrderOpen(true)}>+ New imaging order</Button>
          )}
        />

        {orders.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No imaging orders yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {orders.map((order) => (
              <li key={order._id} className="py-3">
                <Link
                  to={`/radiology/orders/${order._id}`}
                  className="flex items-start justify-between gap-4 hover:opacity-80"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-brand-600">
                        {order.orderNumber}
                      </span>
                      <Badge tone={RAD_STATUS_TONES[order.status] ?? 'neutral'}>{order.status}</Badge>
                      {order.priority !== 'routine' && (
                        <Badge tone={PRIORITY_TONES[order.priority]}>
                          {order.priority === 'stat' ? 'STAT' : order.priority}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {order.name} · {MODALITY_LABELS[order.modality] ?? order.modality} · ordered{' '}
                      {formatDate(order.createdAt)} by {fullName(order.orderedBy)}
                    </div>
                  </div>
                  {order.reportPath && (
                    <span className="shrink-0 text-xs font-medium text-brand-600">📄 Report</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Report timeline"
          description="Every imaging report for this patient, newest first"
        />
        {results.length === 0 ? (
          <EmptyState
            icon="🩻"
            title="No reports yet"
            description="Reports appear here once the radiologist has verified them."
          />
        ) : (
          <div className="space-y-4">
            {results.map((result) => (
              <div key={result._id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {result.radiologyOrderId?.name ?? 'Imaging report'}
                    </span>
                    <Badge tone={result.status === 'preliminary' ? 'warning' : 'success'}>
                      {result.status}
                    </Badge>
                    {result.isCritical && <Badge tone="danger">Critical</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{formatDate(result.createdAt, { withTime: true })}</span>
                    {result.radiologyOrderId?.reportPath && (
                      <a
                        href={radiologyApi.reportUrl(result.radiologyOrderId._id)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand-600 hover:text-brand-700"
                      >
                        📄 Report
                      </a>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Impression: </span>
                  {result.impression}
                </p>
                {result.findings && (
                  <p className="mt-1 text-xs text-slate-500">{result.findings}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <NewRadiologyOrderModal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        patient={patient}
        onCreated={(order) => {
          setNotice(`Imaging order ${order.orderNumber} placed and charged to the visit.`);
          load();
        }}
      />
    </div>
  );
}

export default PatientRadiologyTab;
