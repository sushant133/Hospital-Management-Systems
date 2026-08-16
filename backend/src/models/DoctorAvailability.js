import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/** 0 = Sunday … 6 = Saturday, matching JavaScript's Date#getDay(). */
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];

export const DAY_LABELS = Object.freeze({
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
});

/** 'HH:MM' on a 24-hour clock. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight for an 'HH:MM' string — the form all slot maths uses. */
export function toMinutes(time) {
  const [hours, minutes] = String(time).split(':').map(Number);
  return hours * 60 + minutes;
}

/** Inverse of toMinutes: 545 -> '09:05'. */
export function toTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * A recurring weekly window in which a doctor sees patients.
 *
 * One row per (doctor, day, window), so a split clinic — 09:00–12:00 then
 * 15:00–18:00 on a Monday — is two rows rather than a nested structure. Slot
 * generation (services/appointmentService.js) reads these and subtracts what is
 * already booked.
 *
 * Times are wall-clock strings in the hospital's local timezone, deliberately
 * not Dates: "Monday 09:00" is a rule, not an instant, and must not shift when
 * the clocks change.
 *
 * Doctor leave is NOT modelled here — that arrives with Phase 5 attendance, at
 * which point slot generation should also subtract approved leave.
 */
const doctorAvailabilitySchema = new Schema(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Availability must belong to a doctor'],
      index: true,
    },

    /** Where the clinic sits. Defaults to the doctor's own department at write time. */
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'Availability must name a department'],
      index: true,
    },

    dayOfWeek: {
      type: Number,
      required: [true, 'Day of week is required'],
      enum: { values: DAYS_OF_WEEK, message: '{VALUE} is not a valid day of week' },
      index: true,
    },

    startTime: {
      type: String,
      required: [true, 'Start time is required'],
      match: [TIME_PATTERN, 'Start time must be HH:MM on a 24-hour clock'],
    },
    endTime: {
      type: String,
      required: [true, 'End time is required'],
      match: [TIME_PATTERN, 'End time must be HH:MM on a 24-hour clock'],
    },

    /** Appointment length. Slots are generated back-to-back at this cadence. */
    slotMinutes: { type: Number, default: 15, min: 5, max: 240 },

    /**
     * How many patients may hold the same slot. 1 for a normal clinic; higher
     * where a doctor deliberately overbooks a busy OPD.
     */
    slotCapacity: { type: Number, default: 1, min: 1, max: 10 },

    /** The window applies from this date, and until effectiveTo if set. */
    effectiveFrom: { type: Date, default: () => new Date() },
    effectiveTo: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'doctorAvailability',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

doctorAvailabilitySchema.plugin(auditable);

doctorAvailabilitySchema.index({ doctorId: 1, dayOfWeek: 1, isActive: 1 });
doctorAvailabilitySchema.index({ departmentId: 1, dayOfWeek: 1, isActive: 1 });

/** A window must end after it starts, and be long enough for one slot. */
doctorAvailabilitySchema.pre('validate', function checkWindow(next) {
  if (this.startTime && this.endTime && TIME_PATTERN.test(this.startTime) && TIME_PATTERN.test(this.endTime)) {
    const start = toMinutes(this.startTime);
    const end = toMinutes(this.endTime);

    if (end <= start) {
      return next(new Error('End time must be after start time'));
    }
    if (end - start < this.slotMinutes) {
      return next(
        new Error(`Window is ${end - start} minutes but a slot is ${this.slotMinutes} minutes`),
      );
    }
  }

  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo < this.effectiveFrom) {
    return next(new Error('effectiveTo cannot be before effectiveFrom'));
  }

  return next();
});

/** True when this window is in force on the given date. */
doctorAvailabilitySchema.methods.appliesOn = function appliesOn(date) {
  if (this.effectiveFrom && date < startOfDay(this.effectiveFrom)) return false;
  if (this.effectiveTo && date > endOfDay(this.effectiveTo)) return false;
  return date.getDay() === this.dayOfWeek;
};

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export const DoctorAvailability = mongoose.model('DoctorAvailability', doctorAvailabilitySchema);
export default DoctorAvailability;
