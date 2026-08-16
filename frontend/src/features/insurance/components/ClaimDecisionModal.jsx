import { useEffect, useState } from 'react';
import { insuranceApi } from '../../../api/insuranceApi.js';
import { fullName } from '../../../utils/format.js';
import { Alert, Button, Input, Modal, Select, Textarea } from '../../../components/ui/index.js';

const DECISION_OPTIONS = [
  { value: 'under-review', label: 'Under review — no decision yet' },
  { value: 'approved', label: 'Approved in full' },
  { value: 'partially-approved', label: 'Partially approved' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * Recording what the insurer said, or the money arriving.
 *
 * The amounts are checked here for a fast answer, but the server re-checks
 * every one of them — an approval above what was claimed, a "partial" for the
 * full amount, or a settlement above the approval are all refused there.
 */
export function ClaimDecisionModal({ action, claim, onClose, onDone }) {
  const [status, setStatus] = useState('approved');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [settledAmount, setSettledAmount] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [insurerReference, setInsurerReference] = useState('');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const open = Boolean(action && claim);
  const isSettle = action === 'settle';

  useEffect(() => {
    if (!open) return;
    setStatus('approved');
    setApprovedAmount(String(claim.claimedAmount ?? ''));
    setSettledAmount(String(claim.approvedAmount ?? ''));
    setRejectionReason('');
    setInsurerReference(claim.insurerReference ?? '');
    setNotes('');
    setError(null);
  }, [open, claim?._id, claim?.claimedAmount, claim?.approvedAmount, claim?.insurerReference]);

  const submit = async () => {
    setError(null);

    if (isSettle) {
      const amount = Number(settledAmount);
      if (!(amount >= 0)) return setError('Enter the amount received.');
      if (amount > (claim.approvedAmount ?? 0)) {
        return setError(`Cannot settle more than the approved ${claim.approvedAmount}.`);
      }
    } else {
      if (status === 'rejected' && rejectionReason.trim().length < 5) {
        return setError('Give a rejection reason of at least 5 characters.');
      }
      if (['approved', 'partially-approved'].includes(status)) {
        const amount = Number(approvedAmount);
        if (!(amount > 0)) return setError('Enter the approved amount.');
        if (amount > (claim.claimedAmount ?? 0)) {
          return setError(`The insurer cannot approve more than the claimed ${claim.claimedAmount}.`);
        }
        if (status === 'partially-approved' && amount >= (claim.claimedAmount ?? 0)) {
          return setError('A partial approval must be for less than the claimed amount.');
        }
      }
    }

    setSaving(true);
    try {
      const response = isSettle
        ? await insuranceApi.settleClaim(claim._id, {
            settledAmount: Number(settledAmount),
            insurerReference: insurerReference.trim() || undefined,
            notes: notes.trim() || undefined,
          })
        : await insuranceApi.claimDecision(claim._id, {
            status,
            approvedAmount: ['approved', 'partially-approved'].includes(status)
              ? Number(approvedAmount)
              : 0,
            rejectionReason: status === 'rejected' ? rejectionReason.trim() : undefined,
            insurerReference: insurerReference.trim() || undefined,
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
      title={isSettle ? 'Record settlement' : "Record the insurer's decision"}
      description={`${claim.claimNumber} · ${fullName(claim.patientId)} · ${claim.providerId?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>
            {isSettle ? 'Record settlement' : 'Record decision'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Claimed from insurer</span>
            <span className="font-semibold">{claim.claimedAmount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Patient responsibility</span>
            <span>{claim.patientResponsible}</span>
          </div>
          {claim.approvedAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Already approved</span>
              <span>{claim.approvedAmount}</span>
            </div>
          )}
        </div>

        {isSettle ? (
          <Input
            label="Amount received"
            type="number"
            step="0.01"
            min="0"
            max={claim.approvedAmount}
            required
            value={settledAmount}
            onChange={(event) => setSettledAmount(event.target.value)}
            hint={`Approved: ${claim.approvedAmount}. Settling for less records a shortfall.`}
          />
        ) : (
          <>
            <Select
              label="Decision"
              options={DECISION_OPTIONS}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            />

            {['approved', 'partially-approved'].includes(status) && (
              <Input
                label="Approved amount"
                type="number"
                step="0.01"
                min="0"
                max={claim.claimedAmount}
                required
                value={approvedAmount}
                onChange={(event) => setApprovedAmount(event.target.value)}
              />
            )}

            {status === 'rejected' && (
              <Textarea
                label="Rejection reason"
                required
                rows={2}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Service not covered under the plan…"
              />
            )}
          </>
        )}

        <Input
          label="Insurer reference"
          value={insurerReference}
          onChange={(event) => setInsurerReference(event.target.value)}
          placeholder="ACME-REF-5521"
        />

        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  );
}

export default ClaimDecisionModal;
