import { useCallback, useEffect, useState } from 'react';
import {
  appointmentApi,
  toDateValue,
  toTimeLabel,
} from '../../../api/appointmentApi.js';
import { fullName, formatDate } from '../../../utils/format.js';
import DoctorCalendar from './DoctorCalendar.jsx';
import { Alert, Button, Modal, Select, Textarea } from '../../../components/ui/index.js';

const ENCOUNTER_TYPE_OPTIONS = [
  { value: 'opd', label: 'OPD' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'daycare', label: 'Day care' },
];

const TITLES = {
  cancel: 'Cancel appointment',
  reschedule: 'Reschedule appointment',
  checkIn: 'Check in',
  noShow: 'Mark as no-show',
};

/**
 * The four lifecycle actions the desk performs on a booking.
 *
 * One modal rather than four because they share the same shape — confirm
 * against the appointment, capture a reason, call one endpoint — and the server
 * rejects anything the transition table disallows regardless of what the UI
 * offers.
 */
export function AppointmentActionModal({ action, appointment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [encounterType, setEncounterType] = useState('opd');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const [date, setDate] = useState(toDateValue());
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const open = Boolean(action && appointment);
  const doctorId = appointment?.doctorId?._id ?? appointment?.doctorId;

  // Reset each time the modal is opened for a different action/appointment.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setNotes('');
    setEncounterType('opd');
    setChiefComplaint(appointment?.reason ?? '');
    setSelectedSlot(null);
    setError(null);
    setDate(toDateValue());
  }, [open, action, appointment?._id, appointment?.reason]);

  const loadSlots = useCallback(async () => {
    if (action !== 'reschedule' || !doctorId || !date) return;
    setSlotsLoading(true);
    setError(null);
    try {
      const response = await appointmentApi.slots(doctorId, date);
      setSlots(response.data);
    } catch (err) {
      setError(err.message);
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [action, doctorId, date]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const submit = async () => {
    setError(null);

    if ((action === 'cancel' || action === 'reschedule') && reason.trim().length < 5) {
      return setError('Give a reason of at least 5 characters.');
    }
    if (action === 'reschedule' && !selectedSlot) {
      return setError('Pick a new slot.');
    }

    setSaving(true);
    try {
      const id = appointment._id;
      let response;

      if (action === 'cancel') {
        response = await appointmentApi.cancel(id, { reason: reason.trim() });
      } else if (action === 'reschedule') {
        response = await appointmentApi.reschedule(id, {
          scheduledStart: selectedSlot.start,
          durationMinutes: selectedSlot.durationMinutes,
          reason: reason.trim(),
        });
      } else if (action === 'checkIn') {
        response = await appointmentApi.checkIn(id, {
          encounterType,
          chiefComplaint: chiefComplaint.trim() || undefined,
        });
      } else {
        response = await appointmentApi.noShow(id, notes.trim() ? { notes: notes.trim() } : {});
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={TITLES[action]}
      description={
        appointment
          ? `${appointment.appointmentNumber} · ${fullName(appointment.patientId)} · ${formatDate(
              appointment.scheduledStart,
              { withTime: true },
            )}`
          : ''
      }
      size={action === 'reschedule' ? 'lg' : 'md'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={action === 'cancel' || action === 'noShow' ? 'danger' : 'primary'}
            loading={saving}
            onClick={submit}
          >
            {action === 'cancel' && 'Cancel appointment'}
            {action === 'reschedule' && 'Confirm new time'}
            {action === 'checkIn' && 'Check in'}
            {action === 'noShow' && 'Mark no-show'}
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

        {action === 'cancel' && (
          <>
            <Alert tone="warning">
              This frees the slot and closes the booking. The patient is not notified
              automatically.
            </Alert>
            <Textarea
              label="Reason for cancellation"
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Patient rang to cancel, doctor unavailable…"
              hint="Recorded against the appointment and the audit trail."
            />
          </>
        )}

        {action === 'reschedule' && (
          <>
            <Alert tone="info">
              The original booking is kept and closed as <strong>rescheduled</strong>, linked to the
              new one — the history of the slot the patient gave up is not overwritten.
            </Alert>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="form-label" htmlFor="reschedule-date">
                  New date
                </label>
                <input
                  id="reschedule-date"
                  type="date"
                  className="form-control"
                  value={date}
                  min={toDateValue()}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setSelectedSlot(null);
                  }}
                />
              </div>
              <p className="pb-2 text-sm text-slate-500">
                {appointment.doctorId ? fullName(appointment.doctorId) : 'No doctor assigned'}
              </p>
            </div>

            <DoctorCalendar
              slots={slots}
              loading={slotsLoading}
              selected={selectedSlot?.start}
              onSelect={setSelectedSlot}
              emptyMessage="This doctor has no clinic published on that day."
            />

            {selectedSlot && (
              <p className="text-sm text-slate-600">
                Moving to <strong>{toTimeLabel(selectedSlot.start)}</strong> on{' '}
                {formatDate(selectedSlot.start)}.
              </p>
            )}

            <Textarea
              label="Reason for rescheduling"
              required
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Doctor called into theatre, patient requested a later time…"
            />
          </>
        )}

        {action === 'checkIn' && (
          <>
            <Alert tone="info">
              Checking in opens a visit for this patient — that is what the clinical record, orders
              and charges attach to. If they already have an open visit, this attaches to it.
            </Alert>
            <Select
              label="Visit type"
              options={ENCOUNTER_TYPE_OPTIONS}
              value={encounterType}
              onChange={(event) => setEncounterType(event.target.value)}
            />
            <Textarea
              label="Chief complaint"
              rows={2}
              value={chiefComplaint}
              onChange={(event) => setChiefComplaint(event.target.value)}
              placeholder="What has the patient come in for?"
            />
          </>
        )}

        {action === 'noShow' && (
          <>
            <Alert tone="warning">
              This closes the booking as a no-show. Only appointments whose time has already passed
              can be marked.
            </Alert>
            <Textarea
              label="Notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional — e.g. called twice, no answer."
            />
          </>
        )}
      </div>
    </Modal>
  );
}

export default AppointmentActionModal;
