import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const RESULT_FLAGS = ['normal', 'low', 'high', 'critical-low', 'critical-high', 'abnormal'];
export const RESULT_STATUSES = ['preliminary', 'verified', 'amended'];

/**
 * One measured analyte.
 *
 * The reference range is COPIED from the catalogue at entry time rather than
 * referenced. A range revised next year must not silently re-interpret a result
 * validated under the old range — the printed report has to stay reproducible.
 */
const resultValueSchema = new Schema(
  {
    analyteCode: { type: String, required: true, trim: true },
    analyteName: { type: String, required: true, trim: true },

    /** Raw entry, kept as a string so '<0.01' and 'Negative' are both storable. */
    value: { type: String, required: true, trim: true },
    /** Parsed numeric form when the value is quantitative; null otherwise. */
    numericValue: { type: Number, default: null },

    unit: { type: String, trim: true, default: '' },

    // Snapshot of the range this value was judged against.
    refLow: { type: Number, default: null },
    refHigh: { type: Number, default: null },
    referenceRange: { type: String, trim: true, default: '' },

    flag: { type: String, enum: RESULT_FLAGS, default: 'normal', index: true },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

const labResultSchema = new Schema(
  {
    labOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'LabOrder',
      required: [true, 'Result must reference a lab order'],
      index: true,
    },

    // Denormalized so the longitudinal patient view
    // ("every result for this patient, ever") needs no join through orders.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: true,
      index: true,
    },

    labTestId: { type: Schema.Types.ObjectId, ref: 'LabTest', required: true },
    testCode: { type: String, required: true, trim: true, index: true },
    testName: { type: String, required: true, trim: true },

    values: {
      type: [resultValueSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A result must contain at least one value',
      },
    },

    /** True when any value carries a non-normal flag — drives worklist badges. */
    hasAbnormalValues: { type: Boolean, default: false, index: true },
    /** True when any value is critical — these need urgent clinician attention. */
    hasCriticalValues: { type: Boolean, default: false, index: true },

    status: { type: String, enum: RESULT_STATUSES, default: 'preliminary', index: true },

    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },

    technicianNotes: { type: String, trim: true, default: '' },
    interpretation: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'labResults',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

labResultSchema.plugin(auditable);

// One result document per test per order.
labResultSchema.index({ labOrderId: 1, labTestId: 1 }, { unique: true });
labResultSchema.index({ patientId: 1, createdAt: -1 });

/** Keep the abnormal/critical roll-ups in step with the values array. */
labResultSchema.pre('validate', function computeFlags(next) {
  if (Array.isArray(this.values)) {
    this.hasAbnormalValues = this.values.some((v) => v.flag && v.flag !== 'normal');
    this.hasCriticalValues = this.values.some(
      (v) => v.flag === 'critical-low' || v.flag === 'critical-high',
    );
  }
  next();
});

export const LabResult = mongoose.model('LabResult', labResultSchema);
export default LabResult;
