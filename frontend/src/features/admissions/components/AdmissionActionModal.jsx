import { useCallback, useEffect, useState } from 'react';
import { admissionApi, DISCHARGE_TYPE_OPTIONS } from '../../../api/admissionApi.js';
import { wardsApi } from '../../../api/wardApi.js';
import { fullName, formatDate } from '../../../utils/format.js';
import { Alert, Badge, Button, Modal, Select, Textarea } from '../../../components/ui/index.js';

const TITLES = {
  admit: 'Admit patient',
  transfer: 'Transfer patient',
  discharge: 'Discharge patient',
};

/**
 * Admit, transfer or discharge — the three actions that change a stay.
 *
 * Admit and transfer share the bed picker; only free beds are offered, and the
 * server re-checks availability and the ward's gender rule on submit, so a bed
 * taken by someone else in the meantime is refused rather than double-assigned.
 */
export function AdmissionActionModal({ action, encounter, onClose, onDone }) {
  const [wards, setWards] = useState([]);
  const [wardId, setWardId] = useState('');
  const [beds, setBeds] = useState([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [bedId, setBedId] = useState('');

  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [dischargeType, setDischargeType] = useState('recovered');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const open = Boolean(action && encounter);
  const needsBed = action === 'admit' || action === 'transfer';

  useEffect(() => {
    if (!open) return;
    setReason('');
    setSummary('');
    setDischargeType('recovered');
    setBedId('');
    setWardId('');
    setError(null);
  }, [open, action, encounter?._id]);

  useEffect(() => {
    if (!open || !needsBed) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await wardsApi.list({ limit: 100 });
        if (!cancelled) setWards(response.data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [open, needsBed]);

  const loadBeds = useCallback(async () => {
    if (!wardId) {
      setBeds([]);
      return;
    }
    setBedsLoading(true);
    try {
      const response = await wardsApi.listBeds(wardId, { limit: 200 });
      setBeds(response.data);
    } catch (err) {
      setError(err.message);
      setBeds([]);
    } finally {
      setBedsLoading(false);
    }
  }, [wardId]);

  useEffect(() => {
    loadBeds();
    setBedId('');
  }, [loadBeds]);

  const currentBedId = encounter?.admission?.bedId?._id ?? encounter?.admission?.bedId;
  const freeBeds = beds.filter(
    (bed) => ['available', 'reserved'].includes(bed.status) && String(bed._id) !== String(currentBedId),
  );

  const submit = async () => {
    setError(null);

    if (needsBed && !bedId) return setError('Choose a bed.');
    if (action === 'transfer' && reason.trim().length < 5) {
      return setError('Give a reason of at least 5 characters for the transfer.');
    }
    if (action === 'discharge' && summary.trim().length < 20) {
      return setError('Write a discharge summary of at least 20 characters.');
    }

    setSaving(true);
    try {
      const id = encounter._id;
      let response;

      if (action === 'admit') {
        response = await admissionApi.admit(id, {
          bedId,
          wardId: wardId || undefined,
          reason: reason.trim() || undefined,
        });
      } else if (action === 'transfer') {
        response = await admissionApi.transfer(id, {
          bedId,
          wardId: wardId || undefined,
          reason: reason.trim(),
        });
      } else {
        response = await admissionApi.discharge(id, {
          dischargeSummary: summary.trim(),
          dischargeType,
        });
      }

      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const patient = encounter.patientId;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={TITLES[action]}
      description={
        patient
          ? `${fullName(patient)} · ${patient.mrn ?? ''} · ${encounter.encounterNumber}`
          : encounter.encounterNumber
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={action === 'discharge' ? 'primary' : 'primary'}
            loading={saving}
            onClick={submit}
          >
            {action === 'admit' && 'Admit to bed'}
            {action === 'transfer' && 'Confirm transfer'}
            {action === 'discharge' && 'Discharge'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {action === 'transfer' && encounter.admission?.bedId && (
          <Alert tone="info">
            Currently in <strong>{encounter.admission.bedId?.bedNumber}</strong>
            {encounter.admission.wardId?.name ? `, ${encounter.admission.wardId.name}` : ''}. The
            move is added to the stay's history — each night is billed at the rate of the bed
            actually occupied.
          </Alert>
        )}

        {needsBed && (
          <>
            <Select
              label="Ward"
              placeholder="Choose a ward"
              value={wardId}
              onChange={(event) => setWardId(event.target.value)}
              options={wards.map((ward) => ({
                value: ward._id,
                label: `${ward.name} (${ward.gender}) — ${ward.occupancy?.available ?? 0} free`,
              }))}
              required
              hint="Single-sex wards are enforced by the server, not just hidden here."
            />

            {wardId && (
              <div>
                <p className="form-label">Bed</p>
                {bedsLoading ? (
                  <p className="py-3 text-sm text-slate-500">Loading beds…</p>
                ) : freeBeds.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 py-4 text-center text-sm text-slate-500">
                    No free beds in this ward.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {freeBeds.map((bed) => (
                      <button
                        key={bed._id}
                        type="button"
                        onClick={() => setBedId(bed._id)}
                        className={[
                          'rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
                          String(bedId) === String(bed._id)
                            ? 'border-brand-500 bg-brand-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400',
                        ].join(' ')}
                      >
                        {bed.bedNumber}
                        <span className="block text-[10px] opacity-70">{bed.dailyRate}/day</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {action === 'admit' && (
          <Textarea
            label="Reason for admission"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Defaults to the presenting complaint if left blank."
          />
        )}

        {action === 'transfer' && (
          <Textarea
            label="Reason for transfer"
            required
            rows={2}
            hint="Kept on the stay's history — an unexplained move cannot be reviewed later."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Deteriorating — needs intensive care."
          />
        )}

        {action === 'discharge' && (
          <>
            <Alert tone="warning">
              This releases the bed (to cleaning) and settles the bed charges for every night of the
              stay.
              {encounter.admission?.admittedAt && (
                <>
                  {' '}
                  Admitted {formatDate(encounter.admission.admittedAt, { withTime: true })}.
                </>
              )}
            </Alert>

            <Select
              label="Outcome"
              options={DISCHARGE_TYPE_OPTIONS}
              value={dischargeType}
              onChange={(event) => setDischargeType(event.target.value)}
              required
            />

            <Textarea
              label="Discharge summary"
              required
              rows={6}
              hint="At least 20 characters. A stay that ends with no written account of it is an incomplete record."
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Course of the admission, treatment given, condition on discharge, follow-up plan…"
            />
          </>
        )}

        {needsBed && bedId && (
          <p className="text-sm text-slate-600">
            Selected bed{' '}
            <Badge tone="info">{freeBeds.find((b) => String(b._id) === String(bedId))?.bedNumber}</Badge>
          </p>
        )}
      </div>
    </Modal>
  );
}

export default AdmissionActionModal;
