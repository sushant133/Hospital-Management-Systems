import { useEffect, useState } from 'react';
import { fullName } from '../../../utils/format.js';
import { Alert, Badge, Button, Modal, Textarea } from '../../../components/ui/index.js';

const SEVERITY_TONES = { severe: 'danger', moderate: 'warning', mild: 'neutral' };

/**
 * The allergy gate, as the pharmacist sees it.
 *
 * Deliberately awkward: the reason box starts empty, the confirm button stays
 * disabled until ten characters are typed, and the warning text names the
 * substance and severity rather than saying "allergy detected". Overriding a
 * severe allergy should feel like a decision, because it is one — and the
 * server records who did it and why regardless of what this dialog does.
 *
 * Named for the target structure's `InteractionWarningModal`; today it carries
 * allergy warnings, and drug–drug interaction checks would surface here too.
 */
export function InteractionWarningModal({ open, warnings = [], patient, onClose, onConfirm, saving }) {
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setAcknowledged(false);
    }
  }, [open]);

  const hasSevere = warnings.some((warning) => warning.severity === 'severe');
  const canConfirm = acknowledged && reason.trim().length >= 10 && !saving;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Allergy warning"
      description={patient ? `${fullName(patient)} · ${patient.mrn ?? ''}` : ''}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Do not dispense
          </Button>
          <Button variant="danger" loading={saving} disabled={!canConfirm} onClick={() => onConfirm(reason.trim())}>
            Override and dispense
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone={hasSevere ? 'error' : 'warning'} title={
          hasSevere
            ? 'This patient has a SEVERE recorded allergy to what is being dispensed'
            : 'This patient has a recorded allergy to what is being dispensed'
        }>
          Dispensing anyway is recorded permanently against this dispense, with your name and
          reason, and appears on the patient&apos;s chart.
        </Alert>

        <div className="space-y-2">
          {warnings.map((warning, index) => (
            <div
              key={`${warning.drugId}-${index}`}
              className="rounded-lg border border-red-200 bg-red-50 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{warning.drugName}</span>
                <span className="text-slate-500">matches recorded allergy</span>
                <span className="font-semibold text-red-800">{warning.substance}</span>
                <Badge tone={SEVERITY_TONES[warning.severity] ?? 'neutral'}>
                  {warning.severity}
                </Badge>
              </div>
              {warning.matchedClass && (
                <p className="mt-1 text-xs text-slate-600">
                  Matched on <span className="font-mono">{warning.matchedClass}</span> — the drug
                  name alone would not have caught this.
                </p>
              )}
            </div>
          ))}
        </div>

        <Textarea
          label="Reason for overriding"
          required
          rows={3}
          hint="At least 10 characters. Recorded against the dispense and in the audit trail."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Documented mild rash only, not true anaphylaxis; consultant approved."
        />

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          I have checked the patient&apos;s allergy history and accept clinical responsibility for
          dispensing this medication.
        </label>
      </div>
    </Modal>
  );
}

export default InteractionWarningModal;
