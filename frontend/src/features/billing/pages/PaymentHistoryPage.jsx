import { useCallback, useEffect, useState } from 'react';
import {
  billingApi,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_TYPE_TONES,
} from '../../../api/billingApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Card, PageHeader, Select,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'when', label: 'Received' },
  { key: 'ref', label: 'Receipt' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'method', label: 'Method' },
  { key: 'by', label: 'Taken by' },
  { key: 'amount', label: 'Amount' },
];

const TYPE_OPTIONS = [
  { value: 'payment', label: 'Payments' },
  { value: 'refund', label: 'Refunds' },
  { value: 'credit-note', label: 'Credit notes' },
];

/**
 * The cash desk's day: everything received across every invoice.
 *
 * Refunds and credit notes appear as negative rows rather than being netted
 * away — the till total should reconcile against what actually moved, not
 * against a tidied summary.
 */
export function PaymentHistoryPage() {
  const [type, setType] = useState('');
  const [method, setMethod] = useState('');
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await billingApi.listPayments({
        type: type || undefined,
        method: method || undefined,
        limit: 100,
      });
      setPayments(response.data);
    } catch (err) {
      setError(err.message);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [type, method]);

  useEffect(() => {
    load();
  }, [load]);

  const net = payments.reduce((sum, row) => sum + row.amount, 0);
  const taken = payments.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const returned = payments.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Money received across every invoice, with refunds and credit notes shown as they were recorded."
      />

      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="!p-3">
          <p className="text-xs text-slate-500">Received</p>
          <p className="text-xl font-semibold text-emerald-700">{taken.toFixed(2)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-xs text-slate-500">Refunded</p>
          <p className="text-xl font-semibold text-red-700">{returned.toFixed(2)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-xs text-slate-500">Net</p>
          <p className="text-xl font-semibold text-slate-900">{net.toFixed(2)}</p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select
            options={TYPE_OPTIONS}
            placeholder="All types"
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Filter by type"
          />
        </div>
        <div className="w-44">
          <Select
            options={PAYMENT_METHOD_OPTIONS}
            placeholder="Any method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            aria-label="Filter by method"
          />
        </div>
      </div>

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading payments…</TRMessage>}
          {!loading && payments.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>Nothing recorded.</TRMessage>
          )}
          {!loading &&
            payments.map((payment) => (
              <TR key={payment._id}>
                <TD>
                  <span className="whitespace-nowrap text-sm">
                    {formatDate(payment.receivedAt, { withTime: true })}
                  </span>
                </TD>
                <TD>
                  <span className="font-mono text-xs text-slate-600">{payment.paymentNumber}</span>
                  {payment.reference && (
                    <div className="text-xs text-slate-400">{payment.reference}</div>
                  )}
                </TD>
                <TD>
                  <span className="font-mono text-xs text-slate-600">
                    {payment.invoiceId?.invoiceNumber ?? '—'}
                  </span>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="neutral">{payment.method}</Badge>
                    {payment.type !== 'payment' && (
                      <Badge tone={PAYMENT_TYPE_TONES[payment.type] ?? 'neutral'}>
                        {payment.type}
                      </Badge>
                    )}
                  </div>
                </TD>
                <TD>
                  <span className="text-xs text-slate-500">{fullName(payment.receivedBy)}</span>
                </TD>
                <TD>
                  <span
                    className={
                      payment.amount < 0 ? 'font-medium text-red-700' : 'font-medium text-emerald-700'
                    }
                  >
                    {payment.amount > 0 ? '+' : ''}
                    {payment.amount}
                  </span>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>
    </div>
  );
}

export default PaymentHistoryPage;
