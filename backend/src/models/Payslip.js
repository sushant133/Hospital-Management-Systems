import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

const lineSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    /** Recorded when the component was a percentage, so the payslip explains itself. */
    percentOfBasic: { type: Number, default: null },
  },
  { _id: true },
);

/**
 * One person's pay for one run.
 *
 * Every figure is **snapshotted**, not referenced: a payslip must still explain
 * itself years later, after the salary structure has been revised and the
 * attendance records archived. That is also why the day counts and the rate are
 * stored rather than recomputed on read.
 */
const payslipSchema = new Schema(
  {
    payslipNumber: { type: String, unique: true, index: true },

    payrollRunId: {
      type: Schema.Types.ObjectId,
      ref: 'PayrollRun',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Snapshotted so the payslip reads correctly if the account changes. */
    staffName: { type: String, trim: true, default: '' },
    staffRole: { type: String, trim: true, default: '' },
    period: { type: String, required: true, index: true },

    /** The structure this was computed from, for traceability. */
    salaryStructureId: { type: Schema.Types.ObjectId, ref: 'SalaryStructure', default: null },
    basicSalary: { type: Number, required: true, min: 0 },

    // --- Attendance, as it drove the pay ---
    expectedWorkingDays: { type: Number, required: true, min: 1 },
    daysPresent: { type: Number, default: 0, min: 0 },
    daysAbsent: { type: Number, default: 0, min: 0 },
    daysLeave: { type: Number, default: 0, min: 0 },
    daysHalf: { type: Number, default: 0, min: 0 },
    /** Present + leave + half-days, weighted. What is actually paid for. */
    payableDays: { type: Number, default: 0, min: 0 },
    overtimeHours: { type: Number, default: 0, min: 0 },

    /** Basic × payableDays ÷ expectedWorkingDays. */
    proratedBasic: { type: Number, default: 0, min: 0 },
    overtimePay: { type: Number, default: 0, min: 0 },

    allowances: { type: [lineSchema], default: [] },
    deductions: { type: [lineSchema], default: [] },

    totalAllowances: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },

    gross: { type: Number, default: 0, min: 0 },
    net: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'payslips',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

payslipSchema.plugin(auditable);

// One payslip per person per run, and the self-service lookup.
payslipSchema.index({ payrollRunId: 1, userId: 1 }, { unique: true });
payslipSchema.index({ userId: 1, period: -1 });

payslipSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.payslipNumber) {
    this.payslipNumber = await nextFormattedId('payslipNumber', 'PS', 6);
  }
  next();
});

/** What proportion of the month was actually worked. */
payslipSchema.virtual('attendanceRate').get(function attendanceRate() {
  if (!this.expectedWorkingDays) return 0;
  return Math.round((this.payableDays / this.expectedWorkingDays) * 1000) / 10;
});

export const Payslip = mongoose.model('Payslip', payslipSchema);
export default Payslip;
