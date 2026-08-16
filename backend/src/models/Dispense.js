import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/**
 * One drug drawn from one batch.
 *
 * A single prescribed item can span several rows when FEFO has to take the
 * remainder of an expiring pack and top it up from the next — which is exactly
 * why the batch, its number and its expiry are recorded per row rather than per
 * dispense. A recall traces back through these.
 */
const dispenseItemSchema = new Schema(
  {
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true },
    drugName: { type: String, required: true, trim: true },
    /** Which prescribed line this satisfies. */
    prescriptionItemId: { type: Schema.Types.ObjectId, default: null },

    batchId: { type: Schema.Types.ObjectId, ref: 'DrugBatch', required: true },
    batchNo: { type: String, required: true, trim: true },
    expiryDate: { type: Date, required: true },

    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

/**
 * An allergy warning raised at dispense time.
 *
 * Recorded whether or not it was overridden: a warning that was heeded is
 * evidence the check ran, and one that was overridden is the audit trail for a
 * decision someone made about a patient with a known allergy.
 */
const allergyWarningSchema = new Schema(
  {
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true },
    drugName: { type: String, required: true, trim: true },
    /** The recorded allergy that matched. */
    substance: { type: String, required: true, trim: true },
    severity: { type: String, enum: ['mild', 'moderate', 'severe'], default: 'moderate' },
    /** Which allergen class of the drug triggered the match. */
    matchedClass: { type: String, trim: true, default: '' },

    overridden: { type: Boolean, default: false },
    overriddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    overrideReason: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

const dispenseSchema = new Schema(
  {
    dispenseNumber: { type: String, unique: true, index: true },

    // Patient and encounter are both required.
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
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Prescription',
      required: [true, 'A dispense must reference a prescription'],
      // Indexed below alongside the other query shapes.
    },

    items: {
      type: [dispenseItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A dispense must include at least one item',
      },
    },

    allergyWarnings: { type: [allergyWarningSchema], default: [] },

    totalAmount: { type: Number, default: 0, min: 0 },

    dispensedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dispensedAt: { type: Date, default: () => new Date(), index: true },

    notes: { type: String, trim: true, default: '' },

    /** Set when stock is handed back and returned to its batches. */
    returnedAt: { type: Date, default: null },
    returnedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    returnReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'dispenses',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

dispenseSchema.plugin(auditable);

dispenseSchema.index({ patientId: 1, dispensedAt: -1 });
dispenseSchema.index({ prescriptionId: 1 });
// Recall support: "which patients received batch X?"
dispenseSchema.index({ 'items.batchId': 1 });

dispenseSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.dispenseNumber) {
    this.dispenseNumber = await nextFormattedId('dispenseNumber', 'DSP', 6);
  }
  next();
});

/** The total is always the sum of the lines. */
dispenseSchema.pre('validate', function computeTotal(next) {
  if (Array.isArray(this.items)) {
    const total = this.items.reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0);
    this.totalAmount = Math.round(total * 100) / 100;
  }
  next();
});

dispenseSchema.virtual('wasOverridden').get(function wasOverridden() {
  return (this.allergyWarnings ?? []).some((warning) => warning.overridden);
});

export const Dispense = mongoose.model('Dispense', dispenseSchema);
export default Dispense;
