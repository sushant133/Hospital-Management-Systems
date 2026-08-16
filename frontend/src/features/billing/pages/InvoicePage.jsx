import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  billingApi,
  INVOICE_STATUS_OPTIONS,
  INVOICE_STATUS_TONES,
  DISCOUNT_STATUS_TONES,
  BUCKET_TONES,
  invoiceActions,
} from '../../../api/billingApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import PaymentModal from '../components/PaymentModal.jsx';
import DiscountApprovalModal from '../components/DiscountApprovalModal.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'invoice', label: 'Invoice' },
  { key: 'patient', label: 'Patient' },
  { key: 'total', label: 'Total' },
  { key: 'paid', label: 'Paid / balance' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '' },
];

const TABS = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'outstanding', label: 'Outstanding' },
];

/**
 * The billing desk: bills raised, money taken, and what is still owed.
 */
export function InvoicePage() {
  const { can } = useAuth();
  const canIssue = can(MODULES.INVOICES, 'edit');
  const canVoid = can(MODULES.INVOICES, 'void');
  const canPay = can(MODULES.PAYMENTS, 'create');
  const canRefund = can(MODULES.PAYMENTS, 'refund');
  const canRequestDiscount = can(MODULES.INVOICES, 'applyDiscount');
  const canApproveDiscount = can(MODULES.INVOICES, 'approveDiscount');

  const [tab, setTab] = useState('invoices');
  const [status, setStatus] = useState('');
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  const [invoices, setInvoices] = useState([]);
  const [outstanding, setOutstanding] = useState(null);
  const [selected, setSelected] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const [payModal, setPayModal] = useState({ action: null, invoice: null });
  const [discountModal, setDiscountModal] = useState({ mode: null, invoice: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'invoices') {
        const response = await billingApi.listInvoices({
          status: status || undefined,
          unpaidOnly: unpaidOnly && !status ? 'true' : undefined,
          limit: 100,
        });
        setInvoices(response.data);
      } else {
        setOutstanding(await billingApi.outstanding({}));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, status, unpaidOnly]);

  useEffect(() => {
    load();
  }, [load]);

  /** The payment dialog needs the invoice's payments to offer a reversal target. */
  const openMoney = async (action, invoice) => {
    setBusyId(invoice._id);
    try {
      const response = await billingApi.getInvoice(invoice._id);
      setPayModal({ action, invoice: response.data });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (action, invoice) => {
    if (action === 'pay') return openMoney('pay', invoice);
    if (action === 'refund') return openMoney('refund', invoice);

    if (action === 'void') {
      const reason = window.prompt('Why is this invoice being voided?');
      if (!reason || reason.trim().length < 5) return undefined;
      setBusyId(invoice._id);
      try {
        const response = await billingApi.voidInvoice(invoice._id, { reason: reason.trim() });
        setNotice(response.message);
        await load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusyId(null);
      }
      return undefined;
    }

    setBusyId(invoice._id);
    try {
      const response = await billingApi.issueInvoice(invoice._id, {});
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
    return undefined;
  };

  const ACTION_LABELS = { issue: 'Issue', pay: 'Take payment', refund: 'Refund', void: 'Void' };

  const permitted = { issue: canIssue, pay: canPay, refund: canRefund, void: canVoid };

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Invoices raised against visits, money received, and outstanding balances."
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

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" role="tablist">
          {TABS.map((item) => (
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

      {tab === 'invoices' && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={unpaidOnly}
                onChange={(event) => setUnpaidOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
                disabled={Boolean(status)}
              />
              Unpaid only
            </label>
            <div className="w-48">
              <Select
                options={INVOICE_STATUS_OPTIONS}
                placeholder="Any status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Filter by status"
              />
            </div>
          </div>

          <Table>
            <THead columns={COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={COLUMNS.length}>Loading invoices…</TRMessage>}
              {!loading && invoices.length === 0 && (
                <TRMessage colSpan={COLUMNS.length}>
                  No invoices yet. They are raised from a visit&apos;s charges.
                </TRMessage>
              )}
              {!loading &&
                invoices.map((invoice) => {
                  const actions = invoiceActions(invoice.status).filter((a) => permitted[a]);
                  return (
                    <TR key={invoice._id}>
                      <TD>
                        <span className="font-mono text-xs font-medium text-brand-600">
                          {invoice.invoiceNumber}
                        </span>
                        <div className="text-xs text-slate-400">
                          {invoice.encounterId?.encounterNumber}
                          {invoice.issuedAt ? ` · ${formatDate(invoice.issuedAt)}` : ''}
                        </div>
                      </TD>
                      <TD>
                        <Link
                          to={`/patients/${invoice.patientId?._id}`}
                          className="font-medium text-slate-900 hover:text-brand-700"
                        >
                          {fullName(invoice.patientId)}
                        </Link>
                        <div className="text-xs text-slate-400">{invoice.patientId?.mrn}</div>
                      </TD>
                      <TD>
                        <div className="font-medium">{invoice.total}</div>
                        {invoice.discountAmount > 0 && (
                          <div className="text-xs text-emerald-600">−{invoice.discountAmount} discount</div>
                        )}
                        {invoice.insuranceCoveredAmount > 0 && (
                          <div className="text-xs text-slate-400">
                            insurer {invoice.insuranceCoveredAmount}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <div className="text-sm">{invoice.amountPaid}</div>
                        <div
                          className={
                            invoice.balance > 0 ? 'text-xs font-medium text-red-700' : 'text-xs text-slate-400'
                          }
                        >
                          {invoice.balance > 0 ? `${invoice.balance} due` : 'settled'}
                        </div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'}>
                            {invoice.status}
                          </Badge>
                          {invoice.discountStatus === 'pending' && (
                            <Badge tone={DISCOUNT_STATUS_TONES.pending}>discount pending</Badge>
                          )}
                          {invoice.isOverdue && <Badge tone="danger">overdue</Badge>}
                        </div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap justify-end gap-1">
                          {invoice.discountStatus === 'pending' && canApproveDiscount && (
                            <Button
                              size="sm"
                              onClick={() => setDiscountModal({ mode: 'decide', invoice })}
                            >
                              Review discount
                            </Button>
                          )}
                          {invoice.discountStatus !== 'pending' &&
                            canRequestDiscount &&
                            !['paid', 'void'].includes(invoice.status) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDiscountModal({ mode: 'request', invoice })}
                              >
                                Discount
                              </Button>
                            )}
                          {actions.map((action) => (
                            <Button
                              key={action}
                              size="sm"
                              variant={action === 'pay' ? 'primary' : 'secondary'}
                              loading={busyId === invoice._id}
                              onClick={() => runAction(action, invoice)}
                            >
                              {ACTION_LABELS[action]}
                            </Button>
                          ))}
                          <a
                            href={billingApi.receiptUrl(invoice._id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Receipt
                          </a>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </>
      )}

      {tab === 'outstanding' && (
        loading ? (
          <Spinner label="Building the report…" className="py-10" />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              {Object.entries(outstanding?.meta?.buckets ?? {}).map(([bucket, value]) => (
                <Card key={bucket} className="!p-3">
                  <p className="text-xs text-slate-500">{bucket} days</p>
                  <p className="text-xl font-semibold text-slate-900">{value.amount}</p>
                  <Badge tone={BUCKET_TONES[bucket] ?? 'neutral'}>{value.count} invoice(s)</Badge>
                </Card>
              ))}
            </div>

            {outstanding?.meta?.totals?.overdueCount > 0 && (
              <Alert tone="warning" title="Overdue">
                {outstanding.meta.totals.overdueCount} invoice(s) worth{' '}
                {outstanding.meta.totals.overdueAmount} are past their due date.
              </Alert>
            )}

            <div>
              <CardHeader
                title="Unpaid invoices"
                description={
                  outstanding?.meta?.totals
                    ? `${outstanding.meta.totals.count} outstanding, total ${outstanding.meta.totals.outstanding}`
                    : undefined
                }
              />
              {(outstanding?.data ?? []).length === 0 ? (
                <Card><p className="py-6 text-center text-sm text-slate-500">Nothing outstanding.</p></Card>
              ) : (
                <div className="space-y-2">
                  {outstanding.data.map((row) => (
                    <Card key={row._id} className="!p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{fullName(row.patient)}</p>
                          <p className="text-xs text-slate-500">
                            {row.invoiceNumber} · {row.ageDays} days
                            {row.dueDate ? ` · due ${formatDate(row.dueDate)}` : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{row.balance}</p>
                          <Badge tone={row.overdue ? 'danger' : BUCKET_TONES[row.bucket] ?? 'neutral'}>
                            {row.overdue ? 'overdue' : row.bucket}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      <PaymentModal
        action={payModal.action}
        invoice={payModal.invoice}
        onClose={() => setPayModal({ action: null, invoice: null })}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />

      <DiscountApprovalModal
        mode={discountModal.mode}
        invoice={discountModal.invoice}
        onClose={() => setDiscountModal({ mode: null, invoice: null })}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />
    </div>
  );
}

export default InvoicePage;
