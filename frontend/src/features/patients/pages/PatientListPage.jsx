import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patientsApi, PATIENT_STATUS_OPTIONS, GENDER_OPTIONS } from '../../../api/patientApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { ageFrom, formatDate, fullName, titleCase } from '../../../utils/format.js';
import {
  Alert, Badge, Button, PageHeader, Pagination, Select, Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'mrn', label: 'MRN' },
  { key: 'name', label: 'Patient' },
  { key: 'age', label: 'Age / Gender' },
  { key: 'contact', label: 'Contact' },
  { key: 'registered', label: 'Registered' },
  { key: 'status', label: 'Status' },
];

const STATUS_TONES = { active: 'success', inactive: 'neutral', deceased: 'danger' };

export function PatientListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canRegister = can(MODULES.PATIENTS, 'create');

  const [patients, setPatients] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [gender, setGender] = useState('');
  const [page, setPage] = useState(1);

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await patientsApi.list({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: status || undefined,
        gender: gender || undefined,
        sort: '-createdAt',
      });
      setPatients(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status, gender]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Patients"
        description="Search, register and manage patient records."
        action={
          canRegister && (
            <Button onClick={() => navigate('/patients/new')}>+ Register patient</Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <input
            type="search"
            className="form-control"
            placeholder="Search by name, MRN, phone or email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search patients"
          />
        </div>
        <Select
          options={PATIENT_STATUS_OPTIONS}
          placeholder="All statuses"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        />
        <Select
          options={GENDER_OPTIONS}
          placeholder="All genders"
          value={gender}
          onChange={(event) => {
            setGender(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by gender"
        />
      </div>

      {error && (
        <Alert tone="error" title="Could not load patients" className="mb-4">
          {error}
        </Alert>
      )}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading patients…</TRMessage>}

          {!loading && patients.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>
              {debouncedSearch || status || gender
                ? 'No patients match these filters.'
                : 'No patients registered yet.'}
            </TRMessage>
          )}

          {!loading &&
            patients.map((patient) => {
              const age = ageFrom(patient.dateOfBirth);
              return (
                <TR key={patient._id} onClick={() => navigate(`/patients/${patient._id}`)}>
                  <TD>
                    <span className="font-mono text-xs text-slate-600">{patient.mrn}</span>
                  </TD>
                  <TD>
                    <Link
                      to={`/patients/${patient._id}`}
                      className="font-medium text-slate-900 hover:text-brand-600"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {fullName(patient)}
                    </Link>
                    {patient.bloodGroup && patient.bloodGroup !== 'unknown' && (
                      <span className="ml-2 text-xs text-slate-400">{patient.bloodGroup}</span>
                    )}
                  </TD>
                  <TD>
                    {age !== null ? `${age} yrs` : '—'} · {titleCase(patient.gender)}
                  </TD>
                  <TD>
                    <div className="text-sm">{patient.phone}</div>
                    {patient.email && (
                      <div className="text-xs text-slate-400">{patient.email}</div>
                    )}
                  </TD>
                  <TD>{formatDate(patient.createdAt)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONES[patient.status] ?? 'neutral'}>{patient.status}</Badge>
                  </TD>
                </TR>
              );
            })}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />
    </div>
  );
}

export default PatientListPage;
