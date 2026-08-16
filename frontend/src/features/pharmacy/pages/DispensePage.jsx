import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  pharmacyApi,
  PRESCRIPTION_STATUS_OPTIONS,
  PRESCRIPTION_STATUS_TONES,
  expiryTone,
} from '../../../api/pharmacyApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import InteractionWarningModal from '../components/InteractionWarningModal.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'rx', label: 'Prescription' },
  { key: 'patient', label: 'Patient' },
  { key: 'items', label: 'Items' },
  { key: 'prescriber', label: 'Prescriber' },
  { key: 'status', label: 'Status' },
];

/**
 * The pharmacy counter: the queue of prescriptions, and what it takes to fill
 * one.
 *
 * Selecting a prescription loads a *preview* — which batches FEFO would draw
 * from, and which allergy warnings stand — so the pharmacist sees the whole
 * decision before anything moves off the shelf.
 */
export function DispensePage() {
  const { can } = useAuth();
  const canDispense = can(MODULES.DISPENSING, 'create');
  const canOverride = can(MODULES.DISPENSING, 'overrideAllergyWarning');

  const [status, setStatus] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await pharmacyApi.listPrescriptions({
        status: status || undefined,
        pendingOnly: pendingOnly && !status ? 'true' : undefined,
        limit: 50,
      });
      setPrescriptions(response.data);
    } catch (err) {
      setError(err.message);
      setPrescriptions([]);
    } finally {
      setLoading(false);
    }
  }, [status, pendingOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const select = async (prescription) => {
    setSelected(prescription);
    setPreview(null);
    setPreviewLoading(true);
    setError(null);
    try {
      const response = await pharmacyApi.previewDispense(prescription._id);
      setPreview(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const runDispense = async (overrideReason) => {
    setSaving(true);
    setError(null);
    try {
      const response = await pharmacyApi.dispense(selected._id,
        overrideReason
          ? { overrideAllergyWarning: true, overrideReason }
          : {},
      );
      setNotice(response.message);
      setWarningOpen(false);
      setSelected(null);
      setPreview(null);
      await load();
    } catch (err) {
      // The server is the gate: if it raises the allergy conflict, show the
      // override dialog rather than a bare error.
      if (err.code === 'ALLERGY_WARNING' && canOverride) {
        setWarningOpen(true);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const warnings = preview?.data?.allergyWarnings ?? [];
  const lines = preview?.data?.lines ?? [];
  const canFill = preview?.meta?.canDispenseInFull;

  return (
    <div>
      <PageHeader
        title="Dispensing"
        description="Prescriptions waiting to be filled. Stock is drawn first-expiring-first."
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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(event) => setPendingOnly(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
            disabled={Boolean(status)}
          />
          Outstanding only
        </label>

        <div className="w-52">
          <Select
            options={PRESCRIPTION_STATUS_OPTIONS}
            placeholder="Any status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by status"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table>
            <THead columns={COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={COLUMNS.length}>Loading queue…</TRMessage>}
              {!loading && prescriptions.length === 0 && (
                <TRMessage colSpan={COLUMNS.length}>
                  Nothing waiting — the queue is clear.
                </TRMessage>
              )}
              {!loading &&
                prescriptions.map((rx) => (
                  <TR
                    key={rx._id}
                    onClick={() => select(rx)}
                    className={String(selected?._id) === String(rx._id) ? 'bg-brand-50' : ''}
                  >
                    <TD>
                      <span className="font-mono text-xs font-medium text-brand-600">
                        {rx.prescriptionNumber}
                      </span>
                      <div className="text-xs text-slate-400">{formatDate(rx.createdAt)}</div>
                    </TD>
                    <TD>
                      <Link
                        to={`/patients/${rx.patientId?._id}`}
                        className="font-medium text-slate-900 hover:text-brand-700"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {fullName(rx.patientId)}
                      </Link>
                      <div className="text-xs text-slate-400">{rx.patientId?.mrn}</div>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {rx.items?.slice(0, 3).map((item) => (
                          <Badge key={item._id} tone="info">
                            {item.drugName}
                          </Badge>
                        ))}
                        {rx.items?.length > 3 && (
                          <Badge tone="neutral">+{rx.items.length - 3}</Badge>
                        )}
                      </div>
                    </TD>
                    <TD>{fullName(rx.prescribedBy)}</TD>
                    <TD>
                      <Badge tone={PRESCRIPTION_STATUS_TONES[rx.status] ?? 'neutral'}>
                        {rx.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </div>

        <div>
          <CardHeader
            title="Fill prescription"
            description={selected ? selected.prescriptionNumber : undefined}
          />

          {!selected ? (
            <Card>
              <p className="py-6 text-center text-sm text-slate-500">
                Choose a prescription to see what would be dispensed.
              </p>
            </Card>
          ) : previewLoading ? (
            <Spinner label="Checking stock…" className="py-8" />
          ) : (
            <div className="space-y-3">
              {warnings.length > 0 && (
                <Alert tone="error" title="Allergy warning">
                  {warnings.map((w) => `${w.drugName} matches ${w.substance}`).join('; ')}.
                  {canOverride
                    ? ' Dispensing requires an explicit override.'
                    : ' Your role cannot override this.'}
                </Alert>
              )}

              {!canFill && (
                <Alert tone="warning" title="Not enough stock">
                  Some items cannot be filled in full from current stock.
                </Alert>
              )}

              {lines.length === 0 ? (
                <EmptyState
                  icon="✅"
                  title="Nothing outstanding"
                  description="Every item on this prescription has been dispensed."
                />
              ) : (
                lines.map((line) => (
                  <Card key={line.prescriptionItemId} className="!p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{line.drugName}</p>
                        <p className="text-xs text-slate-500">
                          {line.requested} requested · {line.available} in stock
                        </p>
                      </div>
                      {line.shortfall > 0 ? (
                        <Badge tone="danger">short {line.shortfall}</Badge>
                      ) : (
                        <Badge tone="success">available</Badge>
                      )}
                    </div>

                    {line.allocations?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Batches (first-expiring first)
                        </p>
                        {line.allocations.map((allocation) => (
                          <div
                            key={String(allocation.batchId)}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="font-mono text-slate-600">{allocation.batchNo}</span>
                            <span className="text-slate-500">× {allocation.quantity}</span>
                            <Badge tone={expiryTone(allocation.expiryDate)}>
                              exp {formatDate(allocation.expiryDate)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {line.estimatedTotal > 0 && (
                      <p className="mt-2 text-xs text-slate-500">
                        Charge {line.estimatedTotal.toFixed(2)}
                      </p>
                    )}
                  </Card>
                ))
              )}

              {canDispense && lines.length > 0 && (
                <Button
                  className="w-full"
                  loading={saving}
                  disabled={!canFill}
                  onClick={() => (warnings.length > 0 ? setWarningOpen(true) : runDispense(null))}
                >
                  {warnings.length > 0 ? 'Review allergy warning' : 'Dispense'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <InteractionWarningModal
        open={warningOpen}
        warnings={warnings}
        patient={selected?.patientId}
        saving={saving}
        onClose={() => setWarningOpen(false)}
        onConfirm={(reason) => runDispense(reason)}
      />
    </div>
  );
}

export default DispensePage;
