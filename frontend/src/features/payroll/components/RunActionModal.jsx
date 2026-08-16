import { useEffect, useState } from 'react';
import { payrollApi, periodLabel } from '../../../api/payrollApi.js';
import { Alert, Button, Input, Modal, Textarea } from '../../../components/ui/index.js';

const COPY = {
  approve: {
    title: 'Approve this run',
    description: 'Signs the figures off so they can be paid. After this the run can no longer be rebuilt.',
    confirm: 'Approve run',
  },
  pay: {
    title: 'Mark the run as paid',
    description: 'Records that the money has left the account. This is final.',
    confirm: 'Mark as paid',
  },
  cancel: {
    title: 'Cancel this run',
    description: 'Withdraws the run and its payslips. Build another if the figures were wrong.',
    confirm: 'Cancel run',
  },
};

/**
 * Approving, paying out, or abandoning a run.
 *
 * Approval is deliberately not a one-click action in the table: it authorises
 * money leaving the hospital, and the server refuses it from whoever built the
 * run, so the confirmation names what is being signed off.
 */
export function RunActionModal({ action, run, onClose, onDone }) {
  const [notes, setNotes] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [reason, setReason] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const open = Boolean(action && run);

  useEffect(() => {
    if (!open) return;
    setNotes('');
    setPaymentReference('');
    setReason('');
    setError(null);
  }, [open, run?._id, action]);

  if (!open) return null;

  const copy = COPY[action];

  const submit = async () => {
    setError(null);
    if (action === 'cancel' && reason.trim().length < 5) {
      return setError('Give a reason of at least 5 characters.');
    }

    setSaving(true);
    try {
      const response =
        action === 'approve'
          ? await payrollApi.approveRun(run._id, { notes: notes.trim() || undefined })
          : action === 'pay'
            ? await payrollApi.payRun(run._id, {
                paymentReference: paymentReference.trim() || undefined,
              })
            : await payrollApi.cancelRun(run._id, { reason: reason.trim() });

      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Back</Button>
          <Button
            loading={saving}
            variant={action === 'cancel' ? 'danger' : 'primary'}
            onClick={submit}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Period</span>
            <span className="font-semibold">{periodLabel(run.period)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Payslips</span>
            <span>{run.payslipCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Net to pay</span>
            <span className="font-semibold">{run.totalNet}</span>
          </div>
        </div>

        {action === 'approve' && (
          <Textarea
            label="Approval notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Checked against the attendance register…"
          />
        )}

        {action === 'pay' && (
          <Input
            label="Payment reference"
            value={paymentReference}
            onChange={(event) => setPaymentReference(event.target.value)}
            placeholder="BANK-2026-03"
            hint="The bank transfer or batch reference, so the payment can be traced back."
          />
        )}

        {action === 'cancel' && (
          <Textarea
            label="Reason"
            required
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Opened against the wrong period…"
          />
        )}
      </div>
    </Modal>
  );
}

export default RunActionModal;
