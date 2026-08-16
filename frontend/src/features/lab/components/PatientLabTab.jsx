import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { labApi, LAB_STATUS_TONES, PRIORITY_TONES, FLAG_TONES, FLAG_LABELS } from '../../../api/labApi.js';
import NewLabOrderModal from './NewLabOrderModal.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Spinner,
} from '../../../components/ui/index.js';

/**
 * "Lab" tab on the patient record: order history plus the result timeline,
 * which is the longitudinal view the patientId denormalization exists for.
 */
export function PatientLabTab({ patient }) {
  const { can } = useAuth();
  const canOrder = can(MODULES.LAB_ORDERS, 'create');
  const canViewLab = can(MODULES.LAB_ORDERS, 'view');

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
        labApi.listOrders({ patientId: patient._id, limit: 25, sort: '-createdAt' }),
        labApi.listResults({ patientId: patient._id, limit: 50, sort: '-createdAt' }),
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
    if (canViewLab) load();
    else setLoading(false);
  }, [load, canViewLab]);

  if (!canViewLab) {
    return <Alert tone="info">Your role does not have access to laboratory data.</Alert>;
  }

  if (loading) return <Spinner label="Loading laboratory data…" className="py-16" />;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      <Card>
        <CardHeader
          title="Lab orders"
          description="Requests raised for this patient"
          action={canOrder && <Button size="sm" onClick={() => setOrderOpen(true)}>+ New lab order</Button>}
        />

        {orders.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No lab orders yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {orders.map((order) => (
              <li key={order._id} className="py-3">
                <Link to={`/lab/orders/${order._id}`} className="flex items-start justify-between gap-4 hover:opacity-80">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-brand-600">
                        {order.orderNumber}
                      </span>
                      <Badge tone={LAB_STATUS_TONES[order.status] ?? 'neutral'}>{order.status}</Badge>
                      {order.priority !== 'routine' && (
                        <Badge tone={PRIORITY_TONES[order.priority]}>
                          {order.priority === 'stat' ? 'STAT' : order.priority}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {order.tests?.map((t) => t.code).join(', ')} · ordered{' '}
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
          title="Result timeline"
          description="Every verified result for this patient, newest first"
        />
        {results.length === 0 ? (
          <EmptyState
            icon="🧪"
            title="No results yet"
            description="Results appear here once the laboratory has entered and verified them."
          />
        ) : (
          <div className="space-y-4">
            {results.map((result) => (
              <div key={result._id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{result.testName}</span>
                    <Badge tone="info">{result.testCode}</Badge>
                    <Badge tone={result.status === 'preliminary' ? 'warning' : 'success'}>
                      {result.status}
                    </Badge>
                    {result.hasCriticalValues && <Badge tone="danger">Critical</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{formatDate(result.createdAt, { withTime: true })}</span>
                    {result.labOrderId?.reportPath && (
                      <a
                        href={labApi.reportUrl(result.labOrderId._id)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand-600 hover:text-brand-700"
                      >
                        📄 Report
                      </a>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {result.values.map((value) => (
                        <tr key={value.analyteCode}>
                          <td className="py-1.5 pr-3 text-slate-700">{value.analyteName}</td>
                          <td className={`py-1.5 pr-3 font-medium ${value.flag !== 'normal' ? 'text-amber-700' : 'text-slate-900'}`}>
                            {value.value} <span className="font-normal text-slate-400">{value.unit}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-slate-500">
                            {value.referenceRange || '—'}
                          </td>
                          <td className="py-1.5">
                            {value.flag !== 'normal' && (
                              <Badge tone={FLAG_TONES[value.flag] ?? 'neutral'}>
                                {FLAG_LABELS[value.flag]}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.interpretation && (
                  <p className="mt-2 text-xs text-slate-600">
                    <span className="font-medium">Interpretation: </span>
                    {result.interpretation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <NewLabOrderModal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        patient={patient}
        onCreated={(order) => {
          setNotice(`Lab order ${order.orderNumber} placed and charged to the visit.`);
          load();
        }}
      />
    </div>
  );
}

export default PatientLabTab;
