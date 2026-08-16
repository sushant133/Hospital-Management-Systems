import { useEffect, useState } from 'react';
import { billingApi, PAYMENT_METHOD_OPTIONS } from '../../../api/billingApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import { Alert, Badge, Button, Input, Modal, Select, Textarea } from '../../../components/ui/index.js';

/**
 * Taking money in, and giving it back.
 *
 * A refund is never an edit to the original payment — it is a new negative row
 * pointing at what it reverses, so the record that money was taken survives the
 * record that it was returned. The dialog says so, because a cashier who
 * expects the original line to disappear will otherwise think it failed.
 */
export function PaymentModal({ action, invoice, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [refundType, setRefundType] = useState('refund');
  const [reversalOf, setReversalOf] = useState('');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const open = Boolean(action && invoice);
  const isRefund = action === 'refund';

  useEffect(() => {
    if (!open) return;
    setAmount(isRefund ? '' : String(invoice.balance ?? ''));
    setMethod('cash');
    setReference('');
    setReason('');
    setRefundType('refund');
    setReversalOf('');
    setNotes('');
    setError(null);
  }, [open, isRefund, invoice?._id, invoice?.balance]);

  /** Only real payments can be reversed. */
  const reversible = (invoice?.payments ?? []).filter((p) => p.type === 'payment' && p.amount > 0);

  const submit = async () => {
    setError(null);

    const value = Number(amount);
    if (!(value > 0)) return setError('Enter an amount greater than zero.');

    if (isRefund) {
      if (reason.trim().length < 5) return setError('Give a reason of at least 5 characters.');
      if (value > (invoice.amountPaid ?? 0)) {
        return setError(`Only ${invoice.amountPaid} has been received against this invoice.`);
      }
    } else if (value > (invoice.balance ?? 0)) {
      return setError(`That is more than the outstanding balance of ${invoice.balance}.`);
    }

    setSaving(true);
    try {
      const response = isRefund
        ? await billingApi.recordRefund(invoice._id, {
            amount: value,
            type: refundType,
            reversalOf: reversalOf || undefined,
            method,
            reference: reference.trim() || undefined,
            reason: reason.trim(),
          })
        : await billingApi.recordPayment(invoice._id, {
            amount: value,
            method,
            reference: reference.trim() || undefined,
            notes: notes.trim() || undefined,
          });

      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isRefund ? 'Refund or credit note' : 'Take payment'}
      description={`${invoice.invoiceNumber} · ${fullName(invoice.patientId)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={isRefund ? 'danger' : 'primary'} loading={saving} onClick={submit}>
            {isRefund ? 'Record refund' : 'Record payment'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice total</span>
            <span className="font-semibold">{invoice.total}</span>
          </div>
          {invoice.insuranceCoveredAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Covered by insurer</span>
              <span>−{invoice.insuranceCoveredAmount}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Received so far</span>
            <span>{invoice.amountPaid}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
            <span className="font-medium text-slate-700">Outstanding</span>
            <span className="font-semibold text-slate-900">{invoice.balance}</span>
          </div>
        </div>

        {isRefund && (
          <>
            <Alert tone="info">
              This writes a new negative entry against the invoice. The original payment stays on
              the record — money that moved is reversed, never erased.
            </Alert>

            <Select
              label="Type"
              options={[
                { value: 'refund', label: 'Refund — money returned' },
                { value: 'credit-note', label: 'Credit note — goodwill, no cash moves' },
              ]}
              value={refundType}
              onChange={(event) => setRefundType(event.target.value)}
            />

            {reversible.length > 0 && (
              <Select
                label="Against which payment"
                placeholder="Not tied to a specific payment"
                value={reversalOf}
                onChange={(event) => setReversalOf(event.target.value)}
                options={reversible.map((p) => ({
                  value: p._id,
                  label: `${p.paymentNumber} · ${p.amount} · ${formatDate(p.receivedAt)}`,
                }))}
              />
            )}
          </>
        )}

        <Input
          label="Amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          hint={isRefund ? `At most ${invoice.amountPaid} has been received` : `Outstanding: ${invoice.balance}`}
        />

        <Select
          label={isRefund ? 'Returned by' : 'Method'}
          options={PAYMENT_METHOD_OPTIONS}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        />

        <Input
          label="Reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Transaction id, cheque number…"
        />

        {isRefund ? (
          <Textarea
            label="Reason"
            required
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Duplicate charge, refunded at the desk…"
          />
        ) : (
          <Textarea
            label="Notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        )}

        {!isRefund && Number(amount) > 0 && Number(amount) < (invoice.balance ?? 0) && (
          <p className="text-sm text-slate-600">
            Part payment — <Badge tone="warning">{(invoice.balance - Number(amount)).toFixed(2)} will remain outstanding</Badge>
          </p>
        )}
      </div>
    </Modal>
  );
}

export default PaymentModal;
