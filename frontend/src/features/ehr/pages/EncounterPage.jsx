import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { patientsApi } from '../../../api/patientApi.js';
import { ehrApi } from '../../../api/ehrApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { ageFrom, formatDate, fullName, titleCase } from '../../../utils/format.js';
import AllergyBanner from '../components/AllergyBanner.jsx';
import VitalsForm from '../components/VitalsForm.jsx';
import VitalsTimeline from '../components/VitalsTimeline.jsx';
import SoapNoteEditor from '../components/SoapNoteEditor.jsx';
import NoteList from '../components/NoteList.jsx';
import RoundsPanel from '../../admissions/components/RoundsPanel.jsx';
import MedicationsPanel from '../../pharmacy/components/MedicationsPanel.jsx';
import BillingPanel from '../../billing/components/BillingPanel.jsx';
import AdmissionActionModal from '../../admissions/components/AdmissionActionModal.jsx';
import { cdsApi } from '../../../api/tier23Api.js';
import {
  Alert, Badge, Button, Card, CardHeader, DataRow, PageHeader, Spinner,
} from '../../../components/ui/index.js';

const TABS = [
  { key: 'notes', label: 'Notes', require: [MODULES.CLINICAL_NOTES, 'view'] },
  { key: 'vitals', label: 'Observations' },
  { key: 'rounds', label: 'Ward rounds' },
  { key: 'medication', label: 'Medication', require: [MODULES.PRESCRIPTIONS, 'view'] },
  { key: 'billing', label: 'Billing', require: [MODULES.BILLING, 'view'] },
  { key: 'summary', label: 'Summary' },
];

const STATUS_TONES = {
  open: 'info',
  admitted: 'warning',
  discharged: 'success',
  cancelled: 'neutral',
};

/**
 * The visit workspace — where clinical work on one encounter happens.
 *
 * Everything here hangs off the encounter, which is the clinical spine: notes,
 * observations and (from other phases) orders all carry its id.
 */
export function EncounterPage() {
  const { id } = useParams();
  const { can } = useAuth();

  const [encounter, setEncounter] = useState(null);
  const [patient, setPatient] = useState(null);
  const [vitals, setVitals] = useState([]);
  const [notes, setNotes] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('notes');
  const [amending, setAmending] = useState(null);
  const [admissionAction, setAdmissionAction] = useState(null);
  const [cdsCards, setCdsCards] = useState([]);

  const canViewNotes = can(MODULES.CLINICAL_NOTES, 'view');
  const canWriteNotes = can(MODULES.CLINICAL_NOTES, 'create');
  const canAmendNotes = can(MODULES.CLINICAL_NOTES, 'amend');
  const canRecordVitals = can(MODULES.ENCOUNTERS, 'recordVitals');
  const canRecordRound = can(MODULES.ENCOUNTERS, 'recordRound');
  const canAssignBed = can(MODULES.BEDS, 'assign');
  const canDischarge = can(MODULES.ENCOUNTERS, 'close');

  const closed = encounter && ['discharged', 'cancelled'].includes(encounter.status);
  const admitted = encounter?.status === 'admitted';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const encounterRes = await api.get(`/encounters/${id}`);
      const visit = encounterRes.data;
      setEncounter(visit);

      const patientId = visit.patientId?._id ?? visit.patientId;

      const [patientRes, vitalsRes, notesRes] = await Promise.all([
        patientsApi.get(patientId).catch(() => null),
        ehrApi.encounterVitals(id).catch(() => ({ data: [] })),
        canViewNotes
          ? ehrApi.listNotes({ encounterId: id, limit: 100 }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);

      setPatient(patientRes?.data ?? null);
      setVitals(vitalsRes.data);
      setNotes(notesRes.data);

      if (patientId && can(MODULES.CDS, 'view')) {
        cdsApi.patientView({ patientId, encounterId: id }).then((res) => {
          setCdsCards(res.data?.cards ?? []);
        }).catch(() => {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, canViewNotes, can]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canViewNotes) setTab('vitals');
  }, [canViewNotes]);

  if (loading) return <Spinner label="Loading visit…" className="py-16" />;

  if (error && !encounter) {
    return (
      <Alert tone="error" title="Could not load this visit">
        {error}
      </Alert>
    );
  }

  const visibleTabs = TABS.filter((item) => !item.require || can(...item.require));

  return (
    <div>
      <PageHeader
        breadcrumb={
          patient && (
            <Link to={`/patients/${patient._id}`} className="text-sm text-brand-600 hover:text-brand-700">
              ← {fullName(patient)}
            </Link>
          )
        }
        title={`${encounter.type?.toUpperCase()} visit — ${encounter.encounterNumber}`}
        description={`${encounter.departmentId?.name ?? ''} · opened ${formatDate(
          encounter.startedAt,
          { withTime: true },
        )}`}
        action={
          <div className="flex flex-wrap gap-2">
            {patient && (
              <Link to={`/patients/${patient._id}/timeline`}>
                <Button variant="secondary">Patient timeline</Button>
              </Link>
            )}
            {!closed && !admitted && canAssignBed && (
              <Button onClick={() => setAdmissionAction('admit')}>Admit</Button>
            )}
            {admitted && canAssignBed && (
              <Button variant="secondary" onClick={() => setAdmissionAction('transfer')}>
                Transfer
              </Button>
            )}
            {admitted && canDischarge && (
              <Button onClick={() => setAdmissionAction('discharge')}>Discharge</Button>
            )}
          </div>
        }
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

      {/* Allergies come before anything clinical, always. */}
      {patient && (
        <AllergyBanner allergies={patient.medicalHistory?.allergies ?? []} className="mb-4" />
      )}
      {cdsCards.length > 0 && (
        <div className="mb-4 space-y-2">
          {cdsCards.map((card) => (
            <Alert key={card.uuid} tone={card.indicator === 'critical' ? 'error' : 'warning'} title={card.summary}>
              {card.detail}
            </Alert>
          ))}
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader title="Visit" />
          <DataRow label="Status" value={
            <Badge tone={STATUS_TONES[encounter.status] ?? 'neutral'}>{encounter.status}</Badge>
          } />
          <DataRow label="Type" value={titleCase(encounter.type)} />
          <DataRow label="Attending" value={
            encounter.attendingDoctorId ? fullName(encounter.attendingDoctorId) : '—'
          } />
          {encounter.admission?.admittedAt && (
            <>
              <DataRow
                label="Bed"
                value={
                  encounter.admission.bedId?.bedNumber
                    ? `${encounter.admission.bedId.bedNumber} · ${encounter.admission.wardId?.name ?? ''}`
                    : '—'
                }
              />
              <DataRow
                label="Admitted"
                value={formatDate(encounter.admission.admittedAt, { withTime: true })}
              />
              {encounter.admission.transfers?.length > 0 && (
                <DataRow
                  label="Transfers"
                  value={`${encounter.admission.transfers.length} during this stay`}
                />
              )}
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Patient" />
          {patient ? (
            <>
              <DataRow label="Name" value={fullName(patient)} />
              <DataRow label="MRN" value={patient.mrn} />
              <DataRow
                label="Age / sex"
                value={`${ageFrom(patient.dateOfBirth) ?? '—'} · ${titleCase(patient.gender)}`}
              />
            </>
          ) : (
            <p className="text-sm text-slate-500">Patient details unavailable.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Presenting" />
          <p className="text-sm text-slate-700">
            {encounter.chiefComplaint || <span className="text-slate-400">Not recorded</span>}
          </p>
          {encounter.diagnosis?.length > 0 && (
            <div className="mt-3 space-y-1">
              {encounter.diagnosis.map((d, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <Badge tone={d.type === 'primary' ? 'info' : 'neutral'}>{d.type}</Badge>
                  <span className="text-slate-700">{d.description}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" role="tablist">
          {visibleTabs.map((item) => (
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
              {item.key === 'notes' && notes.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{notes.length}</span>
              )}
              {item.key === 'vitals' && vitals.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{vitals.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'notes' && canViewNotes && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            {(canWriteNotes || amending) && (
              <SoapNoteEditor
                encounterId={id}
                amending={amending}
                disabled={closed && !amending}
                onCancel={() => setAmending(null)}
                onSaved={(response) => {
                  setNotice(response.message);
                  setAmending(null);
                  load();
                }}
              />
            )}
          </div>
          <div>
            <NoteList
              notes={notes}
              canAmend={canAmendNotes}
              onAmend={(note) => {
                setAmending(note);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </div>
        </div>
      )}

      {tab === 'vitals' && (
        <div className="space-y-5">
          {canRecordVitals && (
            <VitalsForm
              encounterId={id}
              disabled={closed}
              onRecorded={(response) => {
                setNotice(response.message);
                load();
              }}
            />
          )}
          <VitalsTimeline
            series={vitals}
            emptyMessage="Observations recorded during this visit appear here."
          />
        </div>
      )}

      {tab === 'rounds' && (
        <RoundsPanel encounterId={id} canRecord={canRecordRound} admitted={admitted} />
      )}

      {tab === 'medication' && (
        <MedicationsPanel
          encounterId={id}
          patient={patient}
          canPrescribe={can(MODULES.PRESCRIPTIONS, 'create')}
          closed={closed}
        />
      )}

      {tab === 'billing' && (
        <BillingPanel
          encounterId={id}
          canInvoice={can(MODULES.INVOICES, 'create')}
          canCharge={can(MODULES.BILLING, 'create')}
        />
      )}

      {tab === 'summary' && (
        <Card>
          <CardHeader title="Visit summary" />
          <DataRow label="Opened" value={formatDate(encounter.startedAt, { withTime: true })} />
          <DataRow
            label="Closed"
            value={encounter.endedAt ? formatDate(encounter.endedAt, { withTime: true }) : '—'}
          />
          <DataRow label="Department" value={encounter.departmentId?.name ?? '—'} />
          <DataRow label="Notes recorded" value={String(notes.length)} />
          <DataRow label="Observation sets" value={String(vitals.length)} />
          {encounter.admission?.transfers?.length > 0 && (
            <div className="mt-4">
              <p className="form-label">Ward history</p>
              <ol className="space-y-1 text-sm text-slate-700">
                <li>
                  Admitted to{' '}
                  <strong>
                    {encounter.admission.transfers[0].fromBedId ? 'first bed' : 'current bed'}
                  </strong>{' '}
                  on {formatDate(encounter.admission.admittedAt, { withTime: true })}
                </li>
                {encounter.admission.transfers.map((move) => (
                  <li key={move._id ?? move.movedAt}>
                    Moved {formatDate(move.movedAt, { withTime: true })}
                    {move.reason ? ` — ${move.reason}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {encounter.admission?.dischargeSummary && (
            <div className="mt-3">
              <p className="form-label">
                Discharge summary
                {encounter.admission.dischargeType && (
                  <Badge tone="neutral" className="ml-2">
                    {encounter.admission.dischargeType}
                  </Badge>
                )}
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {encounter.admission.dischargeSummary}
              </p>
            </div>
          )}
        </Card>
      )}

      <AdmissionActionModal
        action={admissionAction}
        encounter={encounter}
        onClose={() => setAdmissionAction(null)}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />
    </div>
  );
}

export default EncounterPage;
