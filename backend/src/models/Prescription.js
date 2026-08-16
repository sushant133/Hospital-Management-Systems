import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { DRUG_ROUTES } from './Drug.js';

const { Schema } = mongoose;

export const PRESCRIPTION_STATUSES = [
  'pending',
  'partially-dispensed',
  'dispensed',
  'cancelled',
];

/**
 * One prescribed item.
 *
 * `drugName` and `strength` are snapshotted: the printed prescription must
 * still read correctly if the formulary entry is later renamed or retired.
 */
const prescriptionItemSchema = new Schema(
  {
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true },
    drugName: { type: String, required: true, trim: true },
    strength: { type: String, trim: true, default: '' },
    form: { type: String, trim: true, default: '' },

    /** How much per administration, e.g. '1 tablet', '5 ml'. */
    dosage: { type: String, required: [true, 'A dosage is required'], trim: true },
    /** e.g. 'three times a day', 'every 6 hours'. */
    frequency: { type: String, required: [true, 'A frequency is required'], trim: true },
    durationDays: { type: Number, min: 0, max: 365, default: null },
    route: { type: String, enum: DRUG_ROUTES, default: 'oral' },
    instructions: { type: String, trim: true, default: '' },

    /** Total units to supply. */
    quantity: { type: Number, required: true, min: 1 },
    /** Advanced by each dispense until it reaches `quantity`. */
    quantityDispensed: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

/** Nothing may be supplied beyond what was prescribed. */
prescriptionItemSchema.pre('validate', function checkDispensed(next) {
  if (this.quantityDispensed > this.quantity) {
    return next(new Error(`Cannot dispense more ${this.drugName} than was prescribed`));
  }
  return next();
});

const prescriptionSchema = new Schema(
  {
    prescriptionNumber: { type: String, unique: true, index: true },

    // Patient and encounter are both required.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'A prescription must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'A prescription must reference an encounter'],
      index: true,
    },

    prescribedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A prescription must record the prescriber'],
      index: true,
    },

    items: {
      type: [prescriptionItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A prescription must include at least one item',
      },
    },

    notes: { type: String, trim: true, default: '' },

    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'pending', index: true },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'prescriptions',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

prescriptionSchema.plugin(auditable);

// The pharmacy queue, and a patient's medication history.
prescriptionSchema.index({ status: 1, createdAt: -1 });
prescriptionSchema.index({ patientId: 1, createdAt: -1 });
prescriptionSchema.index({ encounterId: 1, isActive: 1 });

prescriptionSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.prescriptionNumber) {
    this.prescriptionNumber = await nextFormattedId('prescriptionNumber', 'RX', 6);
  }
  next();
});

/**
 * Status is DERIVED from the items, never set by hand — the queue and the
 * item counts can then never disagree. Cancellation is the one status set
 * explicitly, and it is left alone here.
 */
prescriptionSchema.methods.refreshStatus = function refreshStatus() {
  if (this.status === 'cancelled') return this.status;
  if (!Array.isArray(this.items)) return this.status;

  const total = this.items.reduce((sum, item) => sum + item.quantity, 0);
  const supplied = this.items.reduce((sum, item) => sum + item.quantityDispensed, 0);

  if (supplied === 0) this.status = 'pending';
  else if (supplied >= total) this.status = 'dispensed';
  else this.status = 'partially-dispensed';

  return this.status;
};

/**
 * What is still owed on each item.
 *
 * Guarded because virtuals run on every serialisation, including when the
 * document was loaded with a narrow projection — populating a dispense's
 * prescription selects only the number and status, leaving `items` undefined.
 */
prescriptionSchema.virtual('outstandingItems').get(function outstanding() {
  if (!Array.isArray(this.items)) return [];
  return this.items
    .filter((item) => item.quantityDispensed < item.quantity)
    .map((item) => ({
      drugId: item.drugId,
      drugName: item.drugName,
      remaining: item.quantity - item.quantityDispensed,
    }));
});

export const Prescription = mongoose.model('Prescription', prescriptionSchema);
export default Prescription;
