import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { SHIFTS } from './Attendance.js';

const { Schema } = mongoose;

/**
 * One person, one day, one planned shift, on one roster.
 *
 * Unique on `{ userId, date }` across every roster so two departments cannot
 * silently double-book the same person. The controller turns that into a
 * conflict naming the other roster rather than a raw duplicate-key error.
 */
const shiftAssignmentSchema = new Schema(
  {
    rosterId: {
      type: Schema.Types.ObjectId,
      ref: 'ShiftRoster',
      required: [true, 'Assignment must belong to a roster'],
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assignment must name a staff member'],
      index: true,
    },

    /** Local midnight of the day being planned. */
    date: { type: Date, required: [true, 'A date is required'], index: true },

    shift: { type: String, enum: SHIFTS, required: [true, 'A shift is required'] },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'shiftAssignments',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

shiftAssignmentSchema.plugin(auditable);

shiftAssignmentSchema.index(
  { userId: 1, date: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
shiftAssignmentSchema.index({ rosterId: 1, date: 1, shift: 1 });

shiftAssignmentSchema.pre('validate', function normaliseDate(next) {
  if (this.date) {
    const d = new Date(this.date);
    d.setHours(0, 0, 0, 0);
    this.date = d;
  }
  next();
});

export const ShiftAssignment = mongoose.model('ShiftAssignment', shiftAssignmentSchema);
export default ShiftAssignment;
