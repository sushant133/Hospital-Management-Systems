import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const PAYROLL_STATUSES = ['draft', 'approved', 'paid', 'cancelled'];

/** Legal forward transitions. The controller refuses anything not listed here. */
export const PAYROLL_TRANSITIONS = Object.freeze({
  draft: ['approved', 'cancelled'],
  approved: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
});

/**
 * One month's payroll.
 *
 * A run is **built** by an accountant and **approved** by an admin — the two
 * are separate permissions for the same reason a discount is: the person who
 * computes what people are owed should not be the person who authorises paying
 * it.
 *
 * While a run is `draft` its payslips are recomputed from attendance on demand.
 * Approval freezes them: after that the figures are what was authorised, and
 * correcting them means cancelling the run and building another.
 */
const payrollRunSchema = new Schema(
  {
    /** YYYY-MM. One run per period. */
    period: {
      type: String,
      required: [true, 'A period is required'],
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'],
      unique: true,
      index: true,
    },

    /**
     * Days the month is paid against. Attendance is divided by this, so a month
     * with 22 working days pro-rates differently from one with 20. Set when the
     * run is opened rather than inferred, because which days count is a policy
     * the hospital owns.
     */
    expectedWorkingDays: { type: Number, required: true, min: 1, max: 31 },

    /** Multiplier on the hourly rate for overtime. */
    overtimeMultiplier: { type: Number, min: 1, max: 4, default: 1.5 },

    status: { type: String, enum: PAYROLL_STATUSES, default: 'draft', index: true },

    payslipCount: { type: Number, default: 0, min: 0 },
    totalGross: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },
    totalNet: { type: Number, default: 0, min: 0 },

    builtBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    builtAt: { type: Date, default: null },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    approvalNotes: { type: String, trim: true, default: '' },

    processedAt: { type: Date, default: null },
    paymentReference: { type: String, trim: true, default: '' },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, default: '' },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'payrollRuns',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

payrollRunSchema.plugin(auditable);

payrollRunSchema.index({ status: 1, period: -1 });

/** Frozen once authorised — the figures are what was signed off. */
payrollRunSchema.virtual('isEditable').get(function isEditable() {
  return this.status === 'draft';
});

export const PayrollRun = mongoose.model('PayrollRun', payrollRunSchema);
export default PayrollRun;
