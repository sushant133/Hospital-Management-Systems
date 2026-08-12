import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { patientsApi } from './patientsApi.js';
import MedicalHistoryTab from './MedicalHistoryTab.jsx';
import PatientLabTab from '../lab/PatientLabTab.jsx';
import { useAuth } from '../../app/AuthContext.jsx';
import { MODULES } from '../../app/permissions.js';
import { ageFrom, formatDate, fullName, initials, titleCase } from '../../lib/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, DataRow, EmptyState, Modal,
  PageHeader, Spinner, Table, TBody, TD, THead, TR, TRMessage,
} from '../../components/ui/index.js';

/**
 * `require` is a [module, action] pair. Tabs carrying clinical data are hidden
 * from roles that can read demographics only — the same split the API enforces.
 */
const TABS = [
  { key: 'demographics', label: 'Demographics' },
  { key: 'history', label: 'Medical history', require: [MODULES.PATIENTS, 'viewMedicalHistory'] },
  { key: 'visits', label: 'Visit history', require: [MODULES.ENCOUNTERS, 'view'] },
  { key: 'lab', label: 'Laboratory', require: [MODULES.LAB_ORDERS, 'view'] },
];

const STATUS_TONES = { active: 'success', inactive: 'neutral', deceased: 'danger' };
const VISIT_TONES = { open: 'info', admitted: 'warning', discharged: 'success', cancelled: 'neutral' };

const VISIT_COLUMNS = [
  { key: 'no', label: 'Visit' },
  { key: 'type', label: 'Type' },
  { key: 'dept', label: 'Department' },
  { key: 'doctor', label: 'Attending' },
  { key: 'started', label: 'Started' },
  { key: 'status', label: 'Status' },
];

export function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const canEditDemographics = can(MODULES.PATIENTS, 'edit');
  const canEditClinical = can(MODULES.PATIENTS, 'editMedicalHistory');
  const canDeactivate = can(MODULES.PATIENTS, 'delete');

  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('demographics');

  const [visits, setVisits] = useState([]);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState(null);

  const loadPatient = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await patientsApi.get(id);
      setPatient(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPatient();
  }, [loadPatient]);

  // Visits load lazily — only when the tab is first opened.
  useEffect(() => {
    if (tab !== 'visits' || visits.length > 0) return;

    let cancelled = false;
    (async () => {
      setVisitsLoading(true);
      setVisitsError(null);
      try {
        const response = await patientsApi.encounters(id, { limit: 50 });
        if (!cancelled) setVisits(response.data);
      } catch (err) {
        if (!cancelled) setVisitsError(err.message);
      } finally {
        if (!cancelled) setVisitsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, id, visits.length]);

  const handleDeactivate = async () => {
    setDeactivating(true);
    setActionError(null);
    try {
      await patientsApi.deactivate(id);
      setConfirmOpen(false);
      navigate('/patients', { replace: true });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setDeactivating(false);
    }
  };

  if (loading) return <Spinner label="Loading patient record…" className="py-20" />;

  if (error) {
    return (
      <div>
        <Alert tone="error" title="Could not load patient">
          {error}
        </Alert>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/patients')}>
          ← Back to patients
        </Button>
      </div>
    );
  }

  if (!patient) return null;

  const age = ageFrom(patient.dateOfBirth);
  const address = patient.address ?? {};
  const addressLine = [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
    .filter(Boolean)
    .join(', ');

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/patients" className="hover:text-slate-700">
            ← Patients
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {fullName(patient)}
            <Badge tone={STATUS_TONES[patient.status] ?? 'neutral'}>{patient.status}</Badge>
            {!patient.isActive && <Badge tone="danger">Deactivated</Badge>}
          </span>
        }
        description={`${patient.mrn} · ${age !== null ? `${age} years` : 'age unknown'} · ${titleCase(patient.gender)}`}
        action={
          <div className="flex gap-2">
            {canEditDemographics && (
              <Button variant="secondary" onClick={() => navigate(`/patients/${id}/edit`)}>
                Edit
              </Button>
            )}
            {canDeactivate && patient.isActive && (
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                Deactivate
              </Button>
            )}
          </div>
        }
      />

      {actionError && (
        <Alert tone="error" className="mb-4" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* Summary strip */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
            {initials(patient)}
          </div>
          <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
            <DataRow label="Blood group" value={patient.bloodGroup === 'unknown' ? '—' : patient.bloodGroup} />
            <DataRow label="Phone" value={patient.phone} />
            <DataRow label="Allergies" value={patient.medicalHistory?.allergies?.length || '—'} />
            <DataRow label="Registered" value={formatDate(patient.createdAt)} />
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" role="tablist">
          {TABS.filter((item) => !item.require || can(...item.require)).map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={[
                'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                tab === item.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'demographics' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Identity" />
            <dl className="divide-y divide-slate-100">
              <DataRow label="Full name" value={fullName(patient)} />
              <DataRow label="Medical record number" value={patient.mrn} />
              <DataRow label="Date of birth" value={`${formatDate(patient.dateOfBirth)}${age !== null ? ` (${age} years)` : ''}`} />
              <DataRow label="Gender" value={titleCase(patient.gender)} />
              <DataRow label="Blood group" value={patient.bloodGroup === 'unknown' ? '—' : patient.bloodGroup} />
              <DataRow label="Marital status" value={titleCase(patient.maritalStatus)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Contact" />
            <dl className="divide-y divide-slate-100">
              <DataRow label="Phone" value={patient.phone} />
              <DataRow label="Email" value={patient.email} />
              <DataRow label="Address" value={addressLine || '—'} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Emergency contact" />
            <dl className="divide-y divide-slate-100">
              <DataRow label="Name" value={patient.emergencyContact?.name} />
              <DataRow label="Relationship" value={patient.emergencyContact?.relationship} />
              <DataRow label="Phone" value={patient.emergencyContact?.phone} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Insurance & record" />
            <dl className="divide-y divide-slate-100">
              <DataRow label="Provider" value={patient.insurance?.provider} />
              <DataRow label="Policy number" value={patient.insurance?.policyNumber} />
              <DataRow label="Valid until" value={patient.insurance?.validTill ? formatDate(patient.insurance.validTill) : '—'} />
              <DataRow label="Registered by" value={patient.registeredBy ? fullName(patient.registeredBy) : '—'} />
              <DataRow label="Last updated" value={formatDate(patient.updatedAt, { withTime: true })} />
            </dl>
          </Card>
        </div>
      )}

      {tab === 'history' && (
        <MedicalHistoryTab
          patient={patient}
          canEdit={canEditClinical}
          onUpdated={(medicalHistory) => setPatient((prev) => ({ ...prev, medicalHistory }))}
        />
      )}

      {tab === 'lab' && <PatientLabTab patient={patient} />}

      {tab === 'visits' && (
        <>
          {visitsError && (
            <Alert tone="error" title="Could not load visits" className="mb-4">
              {visitsError}
            </Alert>
          )}

          {!visitsLoading && visits.length === 0 && !visitsError ? (
            <EmptyState
              icon="🗓️"
              title="No visits recorded"
              description="This patient has no encounter history yet. Visits are created when the patient is checked in."
            />
          ) : (
            <Table>
              <THead columns={VISIT_COLUMNS} />
              <TBody>
                {visitsLoading && <TRMessage colSpan={VISIT_COLUMNS.length}>Loading visits…</TRMessage>}
                {!visitsLoading &&
                  visits.map((visit) => (
                    <TR key={visit._id}>
                      <TD>
                        <span className="font-mono text-xs text-slate-600">{visit.encounterNumber}</span>
                      </TD>
                      <TD>
                        <Badge tone="purple">{visit.type?.toUpperCase()}</Badge>
                      </TD>
                      <TD>{visit.departmentId?.name ?? '—'}</TD>
                      <TD>{visit.attendingDoctorId ? fullName(visit.attendingDoctorId) : '—'}</TD>
                      <TD>{formatDate(visit.startedAt, { withTime: true })}</TD>
                      <TD>
                        <Badge tone={VISIT_TONES[visit.status] ?? 'neutral'}>{visit.status}</Badge>
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Deactivate patient record?"
        description="The record is soft-deleted — it stays in the database for audit and can be restored by an administrator."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deactivating} onClick={handleDeactivate}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          <strong>{fullName(patient)}</strong> ({patient.mrn}) will no longer appear in patient
          searches. Records with open visits cannot be deactivated.
        </p>
      </Modal>
    </div>
  );
}

export default PatientDetailPage;
