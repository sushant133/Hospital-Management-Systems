import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const SPECIMEN_TYPES = [
  'blood',
  'serum',
  'plasma',
  'urine',
  'stool',
  'sputum',
  'swab',
  'csf',
  'tissue',
  'other',
];

/** Numeric analytes carry a reference range; qualitative ones carry expected values. */
export const ANALYTE_VALUE_TYPES = ['numeric', 'text'];

/**
 * One measurable component of a test. A "Full Blood Count" has many analytes
 * (haemoglobin, WBC, platelets); a "Random Blood Sugar" has one.
 *
 * Reference ranges live on the CATALOG, not on the result, so that changing a
 * range never rewrites history — results snapshot the range they were
 * validated against at the time of entry.
 */
const analyteSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    valueType: { type: String, enum: ANALYTE_VALUE_TYPES, default: 'numeric' },
    unit: { type: String, trim: true, default: '' },

    // Numeric reference range.
    refLow: { type: Number, default: null },
    refHigh: { type: Number, default: null },

    // Outside these, the value is life-threatening and flagged 'critical'.
    criticalLow: { type: Number, default: null },
    criticalHigh: { type: Number, default: null },

    /** For qualitative analytes, e.g. ['negative', 'positive']. */
    expectedValues: { type: [String], default: [] },
    /** Which of expectedValues counts as normal, e.g. 'negative'. */
    normalValue: { type: String, trim: true, default: '' },

    displayOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

const labTestSchema = new Schema(
  {
    code: {
      type: String,
      required: [true, 'Test code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Test name is required'], trim: true },
    description: { type: String, trim: true, default: '' },

    /** Owning department — drives revenue attribution on billing lines. */
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'A lab test must belong to a department'],
      index: true,
    },

    specimen: { type: String, enum: SPECIMEN_TYPES, default: 'blood' },
    /** Grouping for the catalogue UI, e.g. 'Haematology', 'Biochemistry'. */
    category: { type: String, trim: true, default: '' },

    price: { type: Number, required: [true, 'Price is required'], min: 0 },

    /** Expected turnaround, shown to the ordering doctor. */
    turnaroundHours: { type: Number, min: 0, default: 24 },

    analytes: {
      type: [analyteSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A test must define at least one analyte',
      },
    },

    preparationNotes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'labTests',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

labTestSchema.plugin(auditable);

labTestSchema.index({ name: 1 });
labTestSchema.index({ category: 1, isActive: 1 });

export const LabTest = mongoose.model('LabTest', labTestSchema);
export default LabTest;
