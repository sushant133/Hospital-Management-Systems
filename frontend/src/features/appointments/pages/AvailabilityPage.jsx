import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  appointmentApi,
  DAY_OPTIONS,
  DAY_LABELS,
} from '../../../api/appointmentApi.js';
import { staffApi } from '../../../api/staffApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { ROLES } from '../../../utils/roles.js';
import { fullName, toDateInput } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, Modal, PageHeader, Select, Spinner,
} from '../../../components/ui/index.js';

const EMPTY_FORM = {
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '13:00',
  slotMinutes: 15,
  slotCapacity: 1,
  effectiveFrom: '',
  effectiveTo: '',
  departmentId: '',
};

/**
 * Weekly clinic windows. Every bookable slot in the system is generated from
 * these rows, so this page is the upstream of the whole scheduling feature.
 */
export function AvailabilityPage() {
  const navigate = useNavigate();
  const { can, user, role } = useAuth();
  const canManage = can(MODULES.APPOINTMENTS, 'manageAvailability');
  const isDoctor = role === ROLES.DOCTOR;

  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [doctorId, setDoctorId] = useState('');

  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

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
        // A doctor manages their own clinic by default.
        if (isDoctor && user?.id) setDoctorId(user.id);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [isDoctor, user?.id]);

  const load = useCallback(async () => {
    if (!doctorId) {
      setWindows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await appointmentApi.listAvailability({ doctorId });
      setWindows(response.data);
    } catch (err) {
      setError(err.message);
      setWindows([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (window) => {
    setEditing(window);
    setForm({
      dayOfWeek: window.dayOfWeek,
      startTime: window.startTime,
      endTime: window.endTime,
      slotMinutes: window.slotMinutes,
      slotCapacity: window.slotCapacity,
      effectiveFrom: toDateInput(window.effectiveFrom),
      effectiveTo: toDateInput(window.effectiveTo),
      departmentId: String(window.departmentId?._id ?? window.departmentId ?? ''),
    });
    setFormError(null);
    setModalOpen(true);
  };

  const update = (field) => (event) => {
    const raw = event.target.value;
    const numeric = ['dayOfWeek', 'slotMinutes', 'slotCapacity'].includes(field);
    setForm((prev) => ({ ...prev, [field]: numeric ? Number(raw) : raw }));
  };

  const save = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        dayOfWeek: form.dayOfWeek,
        startTime: form.startTime,
        endTime: form.endTime,
        slotMinutes: form.slotMinutes,
        slotCapacity: form.slotCapacity,
        departmentId: form.departmentId || undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        effectiveTo: form.effectiveTo || undefined,
      };

      const response = editing
        ? await appointmentApi.updateAvailability(editing._id, payload)
        : await appointmentApi.createAvailability({ ...payload, doctorId });

      setNotice(response.message);
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (window) => {
    setError(null);
    try {
      const response = await appointmentApi.deleteAvailability(window._id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // Group by weekday so a split clinic reads as one day, not two rows.
  const byDay = DAY_OPTIONS.map((day) => ({
    ...day,
    windows: windows.filter((w) => w.dayOfWeek === day.value),
  }));

  return (
    <div>
      <PageHeader
        title="Clinic availability"
        description="Weekly windows a doctor sees patients in. Slots are generated from these."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/appointments')}>
              Back to schedule
            </Button>
            {canManage && doctorId && <Button onClick={openCreate}>Add window</Button>}
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

      <div className="mb-4 w-72">
        <Select
          label="Doctor"
          placeholder="Select a doctor"
          value={doctorId}
          onChange={(event) => setDoctorId(event.target.value)}
          options={doctors.map((d) => ({ value: d._id, label: fullName(d) }))}
          disabled={isDoctor && !can(MODULES.APPOINTMENTS, 'edit')}
        />
      </div>

      {!doctorId ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">
            Choose a doctor to see their weekly clinic.
          </p>
        </Card>
      ) : loading ? (
        <Spinner label="Loading availability…" className="py-10" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {byDay.map((day) => (
            <Card key={day.value}>
              <CardHeader title={day.label} />
              {day.windows.length === 0 ? (
                <p className="text-sm text-slate-400">No clinic.</p>
              ) : (
                <div className="space-y-2">
                  {day.windows.map((window) => (
                    <div
                      key={window._id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900">
                          {window.startTime}–{window.endTime}
                        </span>
                        <Badge tone="info">{window.slotMinutes} min</Badge>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {window.departmentId?.name ?? '—'}
                        {window.slotCapacity > 1 && ` · ${window.slotCapacity} per slot`}
                      </div>
                      {window.effectiveTo && (
                        <div className="mt-1 text-xs text-amber-600">
                          Ends {toDateInput(window.effectiveTo)}
                        </div>
                      )}
                      {canManage && (
                        <div className="mt-2 flex gap-1">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(window)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(window)}>
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit clinic window' : 'Add clinic window'}
        description={`${DAY_LABELS[form.dayOfWeek]} · ${form.startTime}–${form.endTime}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={save}>
              {editing ? 'Save changes' : 'Add window'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <Select
            label="Day"
            options={DAY_OPTIONS}
            value={form.dayOfWeek}
            onChange={update('dayOfWeek')}
            disabled={Boolean(editing)}
            hint={editing ? 'Create a new window to move it to another day.' : undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="avail-start">Start</label>
              <input
                id="avail-start"
                type="time"
                className="form-control"
                value={form.startTime}
                onChange={update('startTime')}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="avail-end">End</label>
              <input
                id="avail-end"
                type="time"
                className="form-control"
                value={form.endTime}
                onChange={update('endTime')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Slot length"
              value={form.slotMinutes}
              onChange={update('slotMinutes')}
              options={[10, 15, 20, 30, 45, 60].map((m) => ({ value: m, label: `${m} minutes` }))}
            />
            <Select
              label="Patients per slot"
              value={form.slotCapacity}
              onChange={update('slotCapacity')}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
              hint="Above 1 allows deliberate overbooking."
            />
          </div>

          <Select
            label="Department"
            placeholder="Doctor's own department"
            value={form.departmentId}
            onChange={update('departmentId')}
            options={departments.map((d) => ({ value: d._id, label: d.name }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="avail-from">Effective from</label>
              <input
                id="avail-from"
                type="date"
                className="form-control"
                value={form.effectiveFrom}
                onChange={update('effectiveFrom')}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="avail-to">Until (optional)</label>
              <input
                id="avail-to"
                type="date"
                className="form-control"
                value={form.effectiveTo}
                onChange={update('effectiveTo')}
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default AvailabilityPage;
