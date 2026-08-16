import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half-day'];

export const SHIFTS = ['morning', 'evening', 'night'];

/**
 * How much of a day's pay each status earns.
 *
 * Leave is paid here — an unpaid-leave policy would add a status rather than
 * change this, so the two kinds stay distinguishable on the record.
 */
export const PAYABLE_FRACTION = Object.freeze({
  present: 1,
  'half-day': 0.5,
  leave: 1,
  absent: 0,
});

/** A standard shift, used to work out what counts as overtime. */
export const STANDARD_SHIFT_HOURS = 8;

/**
 * One staff member, one day.
 *
 * The basis of attendance-driven pay: a payroll run reads these to pro-rate
 * each payslip, so a day that is never recorded is a day that is never paid.
 * Unique on `{ userId, date }` — a second row for the same day would silently
 * double-count.
 */
const attendanceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Attendance must reference a staff member'],
      index: true,
    },

    /** Normalised to local midnight so a day has exactly one row. */
    date: { type: Date, required: [true, 'A date is required'], index: true },

    shift: { type: String, enum: SHIFTS, default: 'morning' },
    status: { type: String, enum: ATTENDANCE_STATUSES, default: 'present', index: true },

    checkInAt: { type: Date, default: null },
    checkOutAt: { type: Date, default: null },

    /** Derived from check-in/out when both are present. */
    hoursWorked: { type: Number, min: 0, max: 24, default: 0 },
    /** Anything beyond a standard shift. */
    overtimeHours: { type: Number, min: 0, max: 16, default: 0 },

    /** A supervisor confirming the record before it drives pay. */
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'attendance',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

attendanceSchema.plugin(auditable);

// One row per person per day, and the query payroll runs over a period.
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });

/** Normalise the date and derive hours before validation. */
attendanceSchema.pre('validate', function normalise(next) {
  if (this.date) {
    const d = new Date(this.date);
    d.setHours(0, 0, 0, 0);
    this.date = d;
  }

  if (this.checkInAt && this.checkOutAt) {
    if (this.checkOutAt <= this.checkInAt) {
      return next(new Error('Check-out must be after check-in'));
    }
    const hours = (this.checkOutAt - this.checkInAt) / 3600000;
    this.hoursWorked = Math.round(hours * 100) / 100;
    this.overtimeHours = Math.max(0, Math.round((hours - STANDARD_SHIFT_HOURS) * 100) / 100);
  }

  return next();
});

/** The share of a day's pay this record earns. */
attendanceSchema.virtual('payableFraction').get(function payableFraction() {
  return PAYABLE_FRACTION[this.status] ?? 0;
});

export const Attendance = mongoose.model('Attendance', attendanceSchema);
export default Attendance;
