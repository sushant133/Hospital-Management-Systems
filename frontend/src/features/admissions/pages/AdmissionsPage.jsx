import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { admissionApi } from '../../../api/admissionApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import BedBoard from '../components/BedBoard.jsx';
import AdmissionActionModal from '../components/AdmissionActionModal.jsx';
import {
  Alert, Badge, Button, PageHeader, Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'patient', label: 'Patient' },
  { key: 'ward', label: 'Ward / bed' },
  { key: 'admitted', label: 'Admitted' },
  { key: 'los', label: 'Stay' },
  { key: 'doctor', label: 'Attending' },
  { key: 'actions', label: '' },
];

/**
 * The ward board: capacity across the hospital, and who is currently in a bed.
 *
 * Occupancy is readable by every role — it reports capacity, not patients — but
 * the admitted list below it names people, so it needs the encounter read grant.
 */
export function AdmissionsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [wards, setWards] = useState([]);
  const [totals, setTotals] = useState(null);
  const [admissions, setAdmissions] = useState([]);
  const [selectedWard, setSelectedWard] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState({ action: null, encounter: null });

  const canSeePatients = can(MODULES.ENCOUNTERS, 'view');
  const canAssign = can(MODULES.BEDS, 'assign');
  const canDischarge = can(MODULES.ENCOUNTERS, 'close');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [occupancyRes, admissionsRes] = await Promise.all([
        admissionApi.occupancy(),
        canSeePatients
          ? admissionApi.list({ wardId: selectedWard?._id, limit: 100 })
          : Promise.resolve({ data: [] }),
      ]);
      setWards(occupancyRes.data);
      setTotals(occupancyRes.meta?.totals);
      setAdmissions(admissionsRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [canSeePatients, selectedWard?._id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Admissions"
        description="Live bed occupancy and the patients currently on the wards."
        action={
          <Button variant="secondary" onClick={() => navigate('/wards')}>
            Manage wards & beds
          </Button>
        }
      />

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" title="Could not load the ward board" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <BedBoard
        wards={wards}
        totals={totals}
        loading={loading}
        selectedWardId={selectedWard?._id}
        onSelectWard={setSelectedWard}
      />

      {canSeePatients && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              {selectedWard ? `Patients in ${selectedWard.name}` : 'Currently admitted'}
            </h2>
            {selectedWard && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedWard(null)}>
                Show all wards
              </Button>
            )}
          </div>

          <Table>
            <THead columns={COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={COLUMNS.length}>Loading admissions…</TRMessage>}
              {!loading && admissions.length === 0 && (
                <TRMessage colSpan={COLUMNS.length}>
                  {selectedWard ? 'No patients in this ward.' : 'Nobody is currently admitted.'}
                </TRMessage>
              )}
              {!loading &&
                admissions.map((stay) => (
                  <TR key={stay._id} onClick={() => navigate(`/encounters/${stay._id}`)}>
                    <TD>
                      <Link
                        to={`/patients/${stay.patientId?._id}`}
                        className="font-medium text-slate-900 hover:text-brand-700"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {fullName(stay.patientId)}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {stay.patientId?.mrn} · {stay.encounterNumber}
                      </div>
                    </TD>
                    <TD>
                      <div className="text-sm">{stay.admission?.wardId?.name ?? '—'}</div>
                      <div className="text-xs text-slate-400">
                        Bed {stay.admission?.bedId?.bedNumber ?? '—'}
                        {stay.admission?.transfers?.length > 0 &&
                          ` · ${stay.admission.transfers.length} transfer(s)`}
                      </div>
                    </TD>
                    <TD>{formatDate(stay.admission?.admittedAt, { withTime: true })}</TD>
                    <TD>
                      <Badge tone={stay.lengthOfStayDays > 7 ? 'warning' : 'neutral'}>
                        {stay.lengthOfStayDays} day{stay.lengthOfStayDays === 1 ? '' : 's'}
                      </Badge>
                    </TD>
                    <TD>{stay.attendingDoctorId ? fullName(stay.attendingDoctorId) : '—'}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {canAssign && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(event) => {
                              event.stopPropagation();
                              setModal({ action: 'transfer', encounter: stay });
                            }}
                          >
                            Transfer
                          </Button>
                        )}
                        {canDischarge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              setModal({ action: 'discharge', encounter: stay });
                            }}
                          >
                            Discharge
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </div>
      )}

      <AdmissionActionModal
        action={modal.action}
        encounter={modal.encounter}
        onClose={() => setModal({ action: null, encounter: null })}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />
    </div>
  );
}

export default AdmissionsPage;
