import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const ROSTER_STATUSES = ['draft', 'published'];

/**
 * A planned week of shifts for one department (or the hospital as a whole).
 *
 * Attendance records what *happened*. This records what was *planned*. Publishing
 * is a separate act from drafting so a half-built week is never what staff see
 * as next week's roster. One roster per (week, department).
 */
const shiftRosterSchema = new Schema(
  {
    /** Monday 00:00 of the week this roster covers. */
    weekStart: { type: Date, required: [true, 'A week start is required'], index: true },

    /**
     * Null means hospital-wide. A department roster and a hospital-wide roster
     * for the same week can coexist; a person still cannot be assigned twice
     * on the same day (enforced on ShiftAssignment).
     */
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },

    status: { type: String, enum: ROSTER_STATUSES, default: 'draft', index: true },

    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'shiftRosters',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

shiftRosterSchema.plugin(auditable);

// One planned week per department. Soft-deleted drafts do not occupy the slot.
shiftRosterSchema.index(
  { weekStart: 1, departmentId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

shiftRosterSchema.virtual('weekEnd').get(function weekEnd() {
  if (!this.weekStart) return null;
  const end = new Date(this.weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
});

export const ShiftRoster = mongoose.model('ShiftRoster', shiftRosterSchema);
export default ShiftRoster;
