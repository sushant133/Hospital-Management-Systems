import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/** ordered → collected → in-progress → completed (cancelled from any pre-completed state). */
export const LAB_ORDER_STATUSES = ['ordered', 'collected', 'in-progress', 'completed', 'cancelled'];

export const LAB_PRIORITIES = ['routine', 'urgent', 'stat'];

/** Legal forward transitions. The controller refuses anything not listed here. */
export const LAB_STATUS_TRANSITIONS = Object.freeze({
  ordered: ['collected', 'cancelled'],
  collected: ['in-progress', 'cancelled'],
  'in-progress': ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

/**
 * A test requested on an order. Name/price are SNAPSHOTTED at order time so a
 * later catalogue edit never rewrites what was ordered or what was billed.
 */
const orderedTestSchema = new Schema(
  {
    labTestId: { type: Schema.Types.ObjectId, ref: 'LabTest', required: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    specimen: { type: String, trim: true, default: 'blood' },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const labOrderSchema = new Schema(
  {
    orderNumber: { type: String, unique: true, index: true },

    // ARCHITECTURE.md §3 — both, always.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Lab order must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'Lab order must reference an encounter'],
      index: true,
    },

    orderedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Lab order must record the ordering clinician'],
      index: true,
    },

    tests: {
      type: [orderedTestSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'An order must include at least one test',
      },
    },

    priority: { type: String, enum: LAB_PRIORITIES, default: 'routine', index: true },
    status: { type: String, enum: LAB_ORDER_STATUSES, default: 'ordered', index: true },

    clinicalNotes: { type: String, trim: true, default: '' },

    // --- Sample tracking ---
    collectedAt: { type: Date, default: null },
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sampleId: { type: String, trim: true, default: '' },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: '' },

    /** Denormalized order total — matches the sum of the billing lines raised. */
    totalPrice: { type: Number, default: 0, min: 0 },

    /** Relative path of the generated PDF, e.g. 'lab-reports/<patientId>/<file>.pdf'. */
    reportPath: { type: String, trim: true, default: '' },
    reportGeneratedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'labOrders',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

labOrderSchema.plugin(auditable);

labOrderSchema.index({ status: 1, priority: 1, createdAt: -1 }); // lab worklist
labOrderSchema.index({ patientId: 1, createdAt: -1 });
labOrderSchema.index({ encounterId: 1, isActive: 1 });

labOrderSchema.pre('save', async function assignOrderNumber(next) {
  if (this.isNew && !this.orderNumber) {
    this.orderNumber = await nextFormattedId('labOrderNumber', 'LAB', 6);
  }
  next();
});

/** Order total is always derived from the snapshotted test prices. */
labOrderSchema.pre('validate', function computeTotal(next) {
  if (Array.isArray(this.tests)) {
    const total = this.tests.reduce((sum, test) => sum + Number(test.price ?? 0), 0);
    this.totalPrice = Math.round(total * 100) / 100;
  }
  next();
});

export const LabOrder = mongoose.model('LabOrder', labOrderSchema);
export default LabOrder;
