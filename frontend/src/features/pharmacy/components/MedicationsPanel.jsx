import { useCallback, useEffect, useState } from 'react';
import {
  pharmacyApi,
  PRESCRIPTION_STATUS_TONES,
} from '../../../api/pharmacyApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import PrescribeModal from './PrescribeModal.jsx';
import EmarPanel from './EmarPanel.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Spinner,
} from '../../../components/ui/index.js';

/**
 * Medication for one visit: what was prescribed, and what the pharmacy has
 * actually handed over.
 *
 * Both are shown because they are different facts — a prescription is an
 * intention, a dispense is an event, and the gap between them is what a ward
 * round needs to see.
 */
export function MedicationsPanel({ encounterId, patient, canPrescribe, closed }) {
  const { can } = useAuth();
  const canChart = can(MODULES.MEDICATION_ADMIN, 'create');
  const canViewMar = can(MODULES.MEDICATION_ADMIN, 'view');
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await pharmacyApi.listPrescriptions({ encounterId, limit: 50 });
      setPrescriptions(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <CardHeader
        title="Medication"
        description="Prescriptions written during this visit, and what has been dispensed."
        action={
          canPrescribe && !closed && (
            <Button onClick={() => setModalOpen(true)}>Prescribe</Button>
          )
        }
      />

      {notice && (
        <Alert tone="success" className="mb-3" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Spinner label="Loading medication…" className="py-8" />
      ) : prescriptions.length === 0 ? (
        <EmptyState
          icon="💊"
          title="Nothing prescribed"
          description={
            closed
              ? 'No medication was prescribed during this visit.'
              : 'Prescriptions written on this visit appear here.'
          }
        />
      ) : (
        <div className="space-y-3">
          {prescriptions.map((rx) => (
            <Card key={rx._id}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs font-medium text-brand-600">
                    {rx.prescriptionNumber}
                  </span>
                  <p className="text-xs text-slate-500">
                    {fullName(rx.prescribedBy)} · {formatDate(rx.createdAt, { withTime: true })}
                  </p>
                </div>
                <Badge tone={PRESCRIPTION_STATUS_TONES[rx.status] ?? 'neutral'}>{rx.status}</Badge>
              </div>

              <ul className="space-y-1.5">
                {rx.items?.map((item) => {
                  const outstanding = item.quantity - item.quantityDispensed;
                  return (
                    <li key={item._id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-slate-900">
                        {item.drugName} {item.strength}
                      </span>
                      <span className="text-slate-600">
                        {item.dosage}, {item.frequency}
                        {item.durationDays ? ` for ${item.durationDays} day(s)` : ''}
                      </span>
                      <span className="text-xs text-slate-400">
                        {item.quantityDispensed}/{item.quantity} dispensed
                      </span>
                      {outstanding > 0 && rx.status !== 'cancelled' && (
                        <Badge tone="warning">{outstanding} outstanding</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>

              {rx.notes && <p className="mt-2 text-xs text-slate-500">{rx.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      <PrescribeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        patient={patient}
        encounterId={encounterId}
        onCreated={(response) => {
          setNotice(response.message);
          load();
        }}
      />

      {canViewMar && (
        <EmarPanel
          encounterId={encounterId}
          prescriptions={prescriptions}
          canChart={canChart}
          closed={closed}
        />
      )}
    </div>
  );
}

export default MedicationsPanel;
