import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  appointmentApi,
  APPOINTMENT_STATUS_TONES,
  availableActions,
  toDateValue,
  toTimeLabel,
} from '../../../api/appointmentApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { ROLES } from '../../../utils/roles.js';
import { fullName } from '../../../utils/format.js';
import QueueBoard from '../components/QueueBoard.jsx';
import AppointmentActionModal from '../components/AppointmentActionModal.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, PageHeader, Select,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'patient', label: 'Patient' },
  { key: 'doctor', label: 'Doctor' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '' },
];

const ACTION_LABELS = {
  checkIn: 'Check in',
  reschedule: 'Reschedule',
  cancel: 'Cancel',
  noShow: 'No-show',
  complete: 'Complete',
};

/**
 * The scheduling desk: one day, either a doctor's list or a whole department's,
 * with the walk-in queue alongside it.
 */
export function CalendarPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can, user, role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isDoctor = role === ROLES.DOCTOR;

  const [date, setDate] = useState(searchParams.get('date') ?? toDateValue());
  const [doctorId, setDoctorId] = useState(searchParams.get('doctorId') ?? '');
  const [departmentId, setDepartmentId] = useState(searchParams.get('departmentId') ?? '');

  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);

  const [appointments, setAppointments] = useState([]);
  const [meta, setMeta] = useState(null);
  const [queue, setQueue] = useState([]);
  const [queueMeta, setQueueMeta] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(location.state?.message ?? null);
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState({ action: null, appointment: null });

  // Booking redirects here with a confirmation; clear it so a refresh or a
  // back-navigation doesn't resurrect a stale message.
  useEffect(() => {
    if (location.state?.message) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  // A doctor lands on their own day; everyone else picks.
  useEffect(() => {
    if (isDoctor && !doctorId && !departmentId && user?.id) setDoctorId(user.id);
  }, [isDoctor, doctorId, departmentId, user?.id]);

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

  // Keep the filters in the URL so a day view can be linked and refreshed.
  useEffect(() => {
    const next = {};
    if (date) next.date = date;
    if (doctorId) next.doctorId = doctorId;
    if (departmentId) next.departmentId = departmentId;
    setSearchParams(next, { replace: true });
  }, [date, doctorId, departmentId, setSearchParams]);

  const load = useCallback(async () => {
    if (!doctorId && !departmentId) {
      setAppointments([]);
      setMeta(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [scheduleRes, queueRes] = await Promise.all([
        appointmentApi.schedule({
          date,
          doctorId: doctorId || undefined,
          departmentId: departmentId || undefined,
        }),
        appointmentApi.queue({ date, departmentId: departmentId || undefined }),
      ]);
      setAppointments(scheduleRes.data);
      setMeta(scheduleRes.meta);
      setQueue(queueRes.data);
      setQueueMeta(queueRes.meta);
    } catch (err) {
      setError(err.message);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [date, doctorId, departmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action, appointment) => {
    // Complete needs no extra input; the rest capture a reason or open a visit.
    if (action !== 'complete') return setModal({ action, appointment });

    setBusyId(appointment._id);
    try {
      const response = await appointmentApi.complete(appointment._id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const permitted = useMemo(
    () => ({
      checkIn: can(MODULES.APPOINTMENTS, 'checkIn'),
      cancel: can(MODULES.APPOINTMENTS, 'cancel'),
      reschedule: can(MODULES.APPOINTMENTS, 'edit'),
      complete: can(MODULES.APPOINTMENTS, 'edit'),
      noShow: can(MODULES.APPOINTMENTS, 'markNoShow'),
    }),
    [can],
  );

  const booked = appointments.filter((a) => !a.isWalkIn);

  return (
    <div>
      <PageHeader
        title="Appointments"
        description="The day's clinic — booked slots, the walk-in queue, and check-in."
        action={
          <div className="flex gap-2">
            {can(MODULES.APPOINTMENTS, 'manageAvailability') && (
              <Button variant="secondary" onClick={() => navigate('/appointments/availability')}>
                Availability
              </Button>
            )}
            {can(MODULES.APPOINTMENTS, 'create') && (
              <Button onClick={() => navigate('/appointments/new')}>Book appointment</Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label" htmlFor="schedule-date">Date</label>
          <input
            id="schedule-date"
            type="date"
            className="form-control"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <div className="w-56">
          <Select
            label="Doctor"
            placeholder="Any doctor"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
            options={doctors.map((d) => ({ value: d._id, label: fullName(d) }))}
          />
        </div>

        <div className="w-56">
          <Select
            label="Department"
            placeholder="Any department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            options={departments.map((d) => ({ value: d._id, label: d.name }))}
          />
        </div>

        <Button variant="ghost" onClick={() => { setDoctorId(''); setDepartmentId(''); }}>
          Clear
        </Button>
      </div>

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" title="Something went wrong" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!doctorId && !departmentId ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">
            Pick a doctor or a department to see the day's schedule.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card padded={false} className="overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <CardHeader
                  className="mb-0"
                  title="Booked appointments"
                  description={
                    meta
                      ? `${booked.length} booked · ${meta.walkIns ?? 0} walk-in(s) · ${
                          meta.byStatus?.['no-show'] ?? 0
                        } no-show(s)`
                      : undefined
                  }
                />
              </div>

              <Table>
                <THead columns={COLUMNS} />
                <TBody>
                  {loading && <TRMessage colSpan={COLUMNS.length}>Loading schedule…</TRMessage>}
                  {!loading && booked.length === 0 && (
                    <TRMessage colSpan={COLUMNS.length}>
                      No booked appointments for this day.
                    </TRMessage>
                  )}
                  {!loading &&
                    booked.map((appointment) => {
                      const actions = availableActions(appointment.status).filter(
                        (action) => permitted[action],
                      );

                      return (
                        <TR key={appointment._id}>
                          <TD>
                            <div className="font-medium text-slate-900">
                              {toTimeLabel(appointment.scheduledStart)}
                            </div>
                            <div className="text-xs text-slate-400">
                              {appointment.durationMinutes} min
                            </div>
                          </TD>
                          <TD>
                            <Link
                              to={`/patients/${appointment.patientId?._id}`}
                              className="font-medium text-slate-900 hover:text-brand-700"
                            >
                              {fullName(appointment.patientId)}
                            </Link>
                            <div className="text-xs text-slate-400">
                              {appointment.patientId?.mrn} · {appointment.appointmentNumber}
                            </div>
                          </TD>
                          <TD>{fullName(appointment.doctorId)}</TD>
                          <TD>
                            <span className="text-sm capitalize">{appointment.type}</span>
                          </TD>
                          <TD>
                            <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status] ?? 'neutral'}>
                              {appointment.status}
                            </Badge>
                          </TD>
                          <TD>
                            <div className="flex flex-wrap justify-end gap-1">
                              {actions.map((action) => (
                                <Button
                                  key={action}
                                  size="sm"
                                  variant={
                                    action === 'cancel' || action === 'noShow' ? 'ghost' : 'secondary'
                                  }
                                  loading={busyId === appointment._id && action === 'complete'}
                                  onClick={() => runAction(action, appointment)}
                                >
                                  {ACTION_LABELS[action]}
                                </Button>
                              ))}
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                </TBody>
              </Table>
            </Card>
          </div>

          <div>
            <CardHeader
              title="Walk-in queue"
              description="Today's arrivals, in the order they were seen at the desk."
              action={
                can(MODULES.APPOINTMENTS, 'create') && (
                  <Button size="sm" variant="secondary" onClick={() => navigate('/appointments/new?walkIn=1')}>
                    Add walk-in
                  </Button>
                )
              }
            />
            <QueueBoard
              queue={queue}
              meta={queueMeta}
              loading={loading}
              canCheckIn={permitted.checkIn}
              busyId={busyId}
              onCheckIn={(entry) => setModal({ action: 'checkIn', appointment: entry })}
            />
          </div>
        </div>
      )}

      <AppointmentActionModal
        action={modal.action}
        appointment={modal.appointment}
        onClose={() => setModal({ action: null, appointment: null })}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />
    </div>
  );
}

export default CalendarPage;
