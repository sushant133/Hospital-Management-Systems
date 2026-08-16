import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/**
 * scheduled → checked-in → completed
 *
 * `cancelled`, `no-show` and `rescheduled` are all terminal: a rescheduled
 * booking is closed and a NEW appointment is created, linked back through
 * rescheduledTo/rescheduledFrom, so the original slot history is never rewritten.
 */
export const APPOINTMENT_STATUSES = [
  'scheduled',
  'checked-in',
  'completed',
  'cancelled',
  'no-show',
  'rescheduled',
];

export const APPOINTMENT_TYPES = ['consultation', 'follow-up', 'procedure', 'review'];

/** Legal forward transitions. The controller refuses anything not listed here. */
export const APPOINTMENT_TRANSITIONS = Object.freeze({
  scheduled: ['checked-in', 'cancelled', 'no-show', 'rescheduled'],
  'checked-in': ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  'no-show': [],
  rescheduled: [],
});

/** Statuses that still occupy their slot — used for conflict and capacity checks. */
export const ACTIVE_APPOINTMENT_STATUSES = ['scheduled', 'checked-in'];

const appointmentSchema = new Schema(
  {
    appointmentNumber: { type: String, unique: true, index: true },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Appointment must reference a patient'],
      index: true,
    },

    /**
     * Optional only for walk-ins, who queue for the department before a doctor
     * is assigned. The controller requires it for booked appointments.
     */
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'Appointment must name a department'],
      index: true,
    },

    type: { type: String, enum: APPOINTMENT_TYPES, default: 'consultation', index: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled', index: true },

    scheduledStart: {
      type: Date,
      required: [true, 'Appointment must have a start time'],
      index: true,
    },
    scheduledEnd: { type: Date, required: [true, 'Appointment must have an end time'] },

    /** Denormalized from the availability window that produced the slot. */
    durationMinutes: { type: Number, required: true, min: 5, max: 480 },

    reason: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // --- Walk-in queue ---
    isWalkIn: { type: Boolean, default: false, index: true },
    /** Per department, per day, allocated at arrival. Null for booked appointments. */
    queueNumber: { type: Number, default: null },

    // --- Check-in ---
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** The visit opened at check-in. This is the hand-off into Phase 3's EHR. */
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null, index: true },

    completedAt: { type: Date, default: null },

    // --- Cancellation (reason is mandatory at the route) ---
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, default: '' },

    // --- No-show ---
    noShowAt: { type: Date, default: null },
    noShowBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // --- Reschedule chain ---
    rescheduledFrom: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    rescheduledTo: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    rescheduleReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'appointments',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

appointmentSchema.plugin(auditable);

// Doctor's day view, and the overlap probe run on every booking.
appointmentSchema.index({ doctorId: 1, scheduledStart: 1, status: 1 });
// Department day schedule and the walk-in queue board.
appointmentSchema.index({ departmentId: 1, scheduledStart: 1, status: 1 });
appointmentSchema.index({ patientId: 1, scheduledStart: -1 });
appointmentSchema.index({ status: 1, scheduledStart: 1 });

appointmentSchema.pre('save', async function assignAppointmentNumber(next) {
  if (this.isNew && !this.appointmentNumber) {
    this.appointmentNumber = await nextFormattedId('appointmentNumber', 'APT', 6);
  }
  next();
});

/** End is always derived from start + duration, so the two can never disagree. */
appointmentSchema.pre('validate', function deriveEnd(next) {
  if (this.scheduledStart && this.durationMinutes) {
    this.scheduledEnd = new Date(this.scheduledStart.getTime() + this.durationMinutes * 60000);
  }
  next();
});

/** True while the booking still holds its slot. */
appointmentSchema.virtual('isActiveBooking').get(function isActiveBooking() {
  return ACTIVE_APPOINTMENT_STATUSES.includes(this.status);
});

export const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;
