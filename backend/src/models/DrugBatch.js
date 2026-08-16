import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const BATCH_STATUSES = ['active', 'expired', 'quarantined', 'depleted'];

/**
 * Physical stock, one row per delivered batch.
 *
 * Stock is tracked per batch rather than as a single count because expiry is a
 * property of the batch, not the drug: dispensing correctly means always
 * reaching for the pack that expires first (FEFO), and writing off an expired
 * batch must not touch the rest of the shelf.
 */
const drugBatchSchema = new Schema(
  {
    drugId: {
      type: Schema.Types.ObjectId,
      ref: 'Drug',
      required: [true, 'A batch must reference a drug'],
      index: true,
    },

    batchNo: { type: String, required: [true, 'Batch number is required'], trim: true },
    expiryDate: { type: Date, required: [true, 'Expiry date is required'], index: true },

    quantityReceived: { type: Number, required: true, min: 0 },
    /** What is left. Decremented by dispensing, adjusted by write-offs. */
    quantityOnHand: { type: Number, required: true, min: 0 },

    costPrice: { type: Number, min: 0, default: 0 },
    supplier: { type: String, trim: true, default: '' },
    receivedAt: { type: Date, default: () => new Date() },

    status: { type: String, enum: BATCH_STATUSES, default: 'active', index: true },

    /** Why stock was written off or quarantined — required by the adjust route. */
    adjustmentNotes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'drugBatches',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

drugBatchSchema.plugin(auditable);

/**
 * ★ THE FEFO INDEX.
 *
 * Every dispense sorts a drug's usable batches by expiry ascending, so this is
 * the index that keeps that query cheap as stock history grows.
 */
drugBatchSchema.index({ drugId: 1, expiryDate: 1 });
drugBatchSchema.index({ drugId: 1, batchNo: 1 }, { unique: true });
drugBatchSchema.index({ status: 1, expiryDate: 1 });

/** A batch runs out — mark it rather than leaving zero-quantity rows "active". */
drugBatchSchema.pre('save', function markDepleted(next) {
  if (this.status === 'active' && this.quantityOnHand === 0) {
    this.status = 'depleted';
  }
  next();
});

drugBatchSchema.pre('validate', function checkQuantities(next) {
  if (this.quantityOnHand > this.quantityReceived) {
    return next(new Error('Quantity on hand cannot exceed the quantity received'));
  }
  return next();
});

/** True when the batch is past its expiry date, whatever its recorded status. */
drugBatchSchema.virtual('isExpired').get(function isExpired() {
  return this.expiryDate ? new Date(this.expiryDate) < new Date() : false;
});

/** Usable = active, in date, and with something left. */
drugBatchSchema.virtual('isDispensable').get(function isDispensable() {
  return this.status === 'active' && !this.isExpired && this.quantityOnHand > 0;
});

export const DrugBatch = mongoose.model('DrugBatch', drugBatchSchema);
export default DrugBatch;
