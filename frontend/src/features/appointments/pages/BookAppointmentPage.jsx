import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  appointmentApi,
  APPOINTMENT_TYPE_OPTIONS,
  toDateValue,
  toTimeLabel,
} from '../../../api/appointmentApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { patientsApi } from '../../../api/patientApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { ROLES } from '../../../utils/roles.js';
import { fullName, formatDate, ageFrom } from '../../../utils/format.js';
import DoctorCalendar from '../components/DoctorCalendar.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, PageHeader, Select, Spinner, Textarea,
} from '../../../components/ui/index.js';

/**
 * Book a slot, or register a walk-in.
 *
 * Both land in the same collection, so this is one form with a mode switch
 * rather than two pages: the difference is that a walk-in takes a queue number
 * instead of a time.
 */
export function BookAppointmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { role } = useAuth();

  const [isWalkIn, setIsWalkIn] = useState(searchParams.get('walkIn') === '1');

  // --- patient search ---
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [patient, setPatient] = useState(null);

  // --- reference data ---
  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);

  // --- form ---
  const [doctorId, setDoctorId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [type, setType] = useState('consultation');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(toDateValue());
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [doctorRes, deptRes] = await Promise.all([
          staffApi.doctors(),
          departmentsApi.list({ limit: 100 }),
        ]);
        if (cancelled) return;
        setDoctors(doctorRes.data);
        setDepartments(deptRes.data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Preselect a patient when arriving from their chart.
  useEffect(() => {
    const patientId = searchParams.get('patientId');
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await patientsApi.get(patientId);
        if (!cancelled) setPatient(response.data);
      } catch {
        // Falls back to the search box.
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  // Choosing a doctor fills in their department.
  useEffect(() => {
    if (!doctorId) return;
    const doctor = doctors.find((d) => d._id === doctorId);
    const dept = doctor?.departmentId?._id ?? doctor?.departmentId;
    if (dept) setDepartmentId(String(dept));
  }, [doctorId, doctors]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await patientsApi.list({ search: term, limit: 8 });
        setResults(response.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadSlots = useCallback(async () => {
    if (isWalkIn || !doctorId || !date) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    try {
      const response = await appointmentApi.slots(doctorId, date);
      setSlots(response.data);
    } catch (err) {
      setError(err.message);
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [isWalkIn, doctorId, date]);

  useEffect(() => {
    loadSlots();
    setSelectedSlot(null);
  }, [loadSlots]);

  const submit = async () => {
    setError(null);

    if (!patient) return setError('Choose a patient.');
    if (isWalkIn && !departmentId) return setError('Choose a department for the queue.');
    if (!isWalkIn && !doctorId) return setError('Choose a doctor.');
    if (!isWalkIn && !selectedSlot) return setError('Pick a slot.');

    setSaving(true);
    try {
      const shared = {
        patientId: patient._id,
        type,
        reason: reason.trim() || undefined,
      };

      const response = isWalkIn
        ? await appointmentApi.walkIn({
            ...shared,
            departmentId,
            doctorId: doctorId || undefined,
          })
        : await appointmentApi.create({
            ...shared,
            doctorId,
            departmentId: departmentId || undefined,
            scheduledStart: selectedSlot.start,
            durationMinutes: selectedSlot.durationMinutes,
          });

      navigate(
        `/appointments?date=${isWalkIn ? toDateValue() : date}&${
          isWalkIn ? `departmentId=${departmentId}` : `doctorId=${doctorId}`
        }`,
        { state: { message: response.message } },
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={isWalkIn ? 'Register a walk-in' : 'Book an appointment'}
        description={
          isWalkIn
            ? 'The patient is here now — they take the next queue number for the department.'
            : 'Pick a doctor, then a free slot from their published clinic.'
        }
        action={
          <Button variant="secondary" onClick={() => navigate('/appointments')}>
            Back to schedule
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-1">
        {[
          { value: false, label: 'Booked appointment' },
          { value: true, label: 'Walk-in' },
        ].map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => setIsWalkIn(option.value)}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isWalkIn === option.value
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Patient --- */}
        <Card className="lg:col-span-1">
          <CardHeader title="Patient" />

          {patient ? (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
              <div className="font-medium text-slate-900">{fullName(patient)}</div>
              <div className="text-xs text-slate-500">
                {patient.mrn} · {patient.gender} · {ageFrom(patient.dateOfBirth) ?? '—'} yrs
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => { setPatient(null); setSearch(''); }}
              >
                Change
              </Button>
            </div>
          ) : (
            <div>
              <input
                type="search"
                className="form-control"
                placeholder="Search by name, MRN or phone…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {searching && <Spinner label="Searching…" className="py-4" />}
              <div className="mt-2 space-y-1">
                {results.map((result) => (
                  <button
                    key={result._id}
                    type="button"
                    onClick={() => { setPatient(result); setResults([]); setSearch(''); }}
                    className="w-full rounded-lg border border-transparent p-2 text-left hover:bg-slate-50"
                  >
                    <div className="text-sm font-medium text-slate-900">{fullName(result)}</div>
                    <div className="text-xs text-slate-500">
                      {result.mrn} · {result.phone}
                    </div>
                  </button>
                ))}
                {search.trim().length >= 2 && !searching && results.length === 0 && (
                  <p className="py-3 text-center text-sm text-slate-500">No patients match.</p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* --- Scheduling --- */}
        <Card className="lg:col-span-2">
          <CardHeader title={isWalkIn ? 'Queue details' : 'Slot'} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Doctor"
              placeholder={isWalkIn ? 'Assign later (triage)' : 'Select a doctor'}
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              options={doctors.map((d) => ({
                value: d._id,
                label: d.specialization ? `${fullName(d)} — ${d.specialization}` : fullName(d),
              }))}
              required={!isWalkIn}
            />

            <Select
              label="Department"
              placeholder="Select a department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              options={departments.map((d) => ({ value: d._id, label: d.name }))}
              required={isWalkIn}
              hint={!isWalkIn ? "Defaults to the doctor's department" : undefined}
            />

            <Select
              label="Type"
              options={APPOINTMENT_TYPE_OPTIONS}
              value={type}
              onChange={(event) => setType(event.target.value)}
            />

            {!isWalkIn && (
              <div>
                <label className="form-label" htmlFor="book-date">Date</label>
                <input
                  id="book-date"
                  type="date"
                  className="form-control"
                  value={date}
                  min={toDateValue()}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            )}
          </div>

          <div className="mt-4">
            <Textarea
              label="Reason for visit"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Chief complaint, referral note…"
            />
          </div>

          {!isWalkIn && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="form-label mb-0">Available slots</span>
                {selectedSlot && (
                  <Badge tone="info">
                    {toTimeLabel(selectedSlot.start)} · {formatDate(selectedSlot.start)}
                  </Badge>
                )}
              </div>

              {!doctorId ? (
                <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
                  Choose a doctor to see their clinic.
                </p>
              ) : (
                <DoctorCalendar
                  slots={slots}
                  loading={slotsLoading}
                  selected={selectedSlot?.start}
                  onSelect={setSelectedSlot}
                  emptyMessage={
                    role === ROLES.DOCTOR
                      ? 'No clinic published for this day — set it under Availability.'
                      : 'This doctor has no clinic published on that day.'
                  }
                />
              )}
            </div>
          )}

          {isWalkIn && (
            <Alert tone="info" className="mt-4">
              The queue number is issued when you submit — it restarts at 1 each day, per
              department.
            </Alert>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate('/appointments')}>
              Cancel
            </Button>
            <Button loading={saving} onClick={submit}>
              {isWalkIn ? 'Add to queue' : 'Book appointment'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default BookAppointmentPage;
