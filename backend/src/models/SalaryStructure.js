import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const componentSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    /** A fixed amount. Ignored when `percentOfBasic` is set. */
    amount: { type: Number, min: 0, default: 0 },
    /**
     * Percentage of basic pay. Used where a component scales with salary —
     * housing allowance, pension contribution, income tax — so a pay rise does
     * not silently leave them behind.
     */
    percentOfBasic: { type: Number, min: 0, max: 100, default: null },
  },
  { _id: true },
);

/**
 * What one staff member is paid.
 *
 * **A separate collection, deliberately not fields on `User`.** The staff
 * directory (`staff.viewDirectory`) is readable by every signed-in role so that
 * colleagues can be named on orders and bookings — putting salary on the user
 * document would put it one careless projection away from everyone. Pay lives
 * behind `payroll.view`, which only accountants and admins hold.
 *
 * Effective-dated: a rise creates a new structure rather than editing the old
 * one, so a payslip from last year can still be explained.
 */
const salaryStructureSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A salary structure must reference a staff member'],
      index: true,
    },

    basicSalary: { type: Number, required: [true, 'A basic salary is required'], min: 0 },

    allowances: { type: [componentSchema], default: [] },
    deductions: { type: [componentSchema], default: [] },

    /** Bank details for the payment run. */
    bankName: { type: String, trim: true, default: '' },
    bankAccount: { type: String, trim: true, default: '' },

    effectiveFrom: { type: Date, required: [true, 'An effective date is required'] },
    /** Set when superseded by a later structure. */
    effectiveTo: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'salaryStructures',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

salaryStructureSchema.plugin(auditable);

salaryStructureSchema.index({ userId: 1, effectiveFrom: -1 });

salaryStructureSchema.pre('validate', function checkDates(next) {
  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo <= this.effectiveFrom) {
    return next(new Error('The end date must be after the effective date'));
  }
  return next();
});

/** In force on a given date. */
salaryStructureSchema.methods.appliesOn = function appliesOn(date) {
  if (this.effectiveFrom > date) return false;
  if (this.effectiveTo && this.effectiveTo < date) return false;
  return true;
};

export const SalaryStructure = mongoose.model('SalaryStructure', salaryStructureSchema);
export default SalaryStructure;
