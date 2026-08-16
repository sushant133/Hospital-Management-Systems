import { useEffect, useState } from 'react';
import { billingApi } from '../../../api/billingApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import { Alert, Button, Input, Modal, Textarea } from '../../../components/ui/index.js';

/**
 * Requesting a discount, and authorising one.
 *
 * These are deliberately two different acts by two different people:
 * `invoices.applyDiscount` is held by the billing desk, `approveDiscount` by
 * nobody except an admin. Requesting does not move the bill — the request sits
 * until someone with the authority decides, and the server refuses a request
 * approved by the person who made it.
 */
export function DiscountApprovalModal({ mode, invoice, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  const open = Boolean(mode && invoice);
  const isRequest = mode === 'request';

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setReason('');
    setNotes('');
    setError(null);
  }, [open, invoice?._id]);

  const submitRequest = async () => {
    setError(null);

    const value = Number(amount);
    if (!(value > 0)) return setError('Enter a discount greater than zero.');
    if (value > (invoice.subtotal ?? 0)) {
      return setError(`A discount of ${value} exceeds the subtotal of ${invoice.subtotal}.`);
    }
    if (reason.trim().length < 5) return setError('Give a reason of at least 5 characters.');

    setSaving('request');
    try {
      const response = await billingApi.requestDiscount(invoice._id, {
        amount: value,
        reason: reason.trim(),
      });
      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  const decide = async (decision) => {
    setError(null);
    setSaving(decision);
    try {
      const response = await billingApi.decideDiscount(invoice._id, {
        decision,
        notes: notes.trim() || undefined,
      });
      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isRequest ? 'Request a discount' : 'Approve or refuse the discount'}
      description={`${invoice.invoiceNumber} · ${fullName(invoice.patientId)}`}
      footer={
        isRequest ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={saving === 'request'} onClick={submitRequest}>
              Submit request
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" loading={saving === 'reject'} onClick={() => decide('reject')}>
              Refuse
            </Button>
            <Button loading={saving === 'approve'} onClick={() => decide('approve')}>
              Approve
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-semibold">{invoice.subtotal}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Current total</span>
            <span>{invoice.total}</span>
          </div>
        </div>

        {isRequest ? (
          <>
            <Alert tone="info">
              Requesting does not reduce the bill. It waits for someone with the authority to
              approve it — and that cannot be you.
            </Alert>

            <Input
              label="Discount amount"
              type="number"
              step="0.01"
              min="0.01"
              max={invoice.subtotal}
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />

            <Textarea
              label="Reason"
              required
              rows={2}
              hint="The approver needs to know what they are authorising."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Goodwill — long wait in clinic"
            />
          </>
        ) : (
          <>
            <Alert tone="warning" title={`${invoice.discountRequested} requested`}>
              {invoice.discountReason}
            </Alert>

            <p className="text-xs text-slate-500">
              Requested by {fullName(invoice.discountRequestedBy) || 'the billing desk'}
              {invoice.discountRequestedAt
                ? ` on ${formatDate(invoice.discountRequestedAt, { withTime: true })}`
                : ''}
              . Approving reduces the total to{' '}
              <strong>
                {(
                  (invoice.subtotal - invoice.discountRequested) *
                  (1 + (invoice.taxPercent ?? 0) / 100)
                ).toFixed(2)}
              </strong>
              .
            </p>

            <Textarea
              label="Decision notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

export default DiscountApprovalModal;
