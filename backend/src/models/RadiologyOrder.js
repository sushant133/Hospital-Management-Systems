import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { MODALITIES } from './RadiologyExam.js';

const { Schema } = mongoose;

/** ordered → scheduled → in-progress → completed (cancelled from any pre-completed state). */
export const RADIOLOGY_ORDER_STATUSES = [
  'ordered',
  'scheduled',
  'in-progress',
  'completed',
  'cancelled',
];

export const RADIOLOGY_PRIORITIES = ['routine', 'urgent', 'stat'];

/** Legal forward transitions. The controller refuses anything not listed here. */
export const RADIOLOGY_STATUS_TRANSITIONS = Object.freeze({
  ordered: ['scheduled', 'in-progress', 'cancelled'],
  scheduled: ['in-progress', 'cancelled'],
  'in-progress': ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

/**
 * A request for one imaging examination.
 *
 * One exam per order, unlike a lab order's basket: an imaging request is
 * justified, scheduled, performed and reported as a single unit, and two views
 * of different anatomy are two requests with two indications.
 *
 * Exam name and price are SNAPSHOTTED at order time so a later catalogue edit
 * never rewrites what was requested or what was billed.
 */
const radiologyOrderSchema = new Schema(
  {
    orderNumber: { type: String, unique: true, index: true },

    // Patient and encounter are both required.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Radiology order must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'Radiology order must reference an encounter'],
      index: true,
    },

    orderedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Radiology order must record the requesting clinician'],
      index: true,
    },

    // --- Snapshot of the catalogue entry ---
    examId: { type: Schema.Types.ObjectId, ref: 'RadiologyExam', required: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    modality: { type: String, enum: MODALITIES, required: true, index: true },
    bodyPart: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    contrastRequired: { type: Boolean, default: false },

    priority: { type: String, enum: RADIOLOGY_PRIORITIES, default: 'routine', index: true },
    status: { type: String, enum: RADIOLOGY_ORDER_STATUSES, default: 'ordered', index: true },

    /**
     * Why the imaging is being asked for. Required: an unjustified request
     * cannot be vetted, and the radiologist reads the study against it.
     */
    clinicalIndication: {
      type: String,
      required: [true, 'A clinical indication is required'],
      trim: true,
    },

    // --- Scheduling ---
    scheduledFor: { type: Date, default: null, index: true },
    scheduledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // --- Performing ---
    startedAt: { type: Date, default: null },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Radiographer's note about how the study was acquired. */
    acquisitionNotes: { type: String, trim: true, default: '' },

    completedAt: { type: Date, default: null },

    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: '' },

    /** Relative path of the generated PDF, e.g. 'radiology-reports/<patientId>/<file>.pdf'. */
    reportPath: { type: String, trim: true, default: '' },
    reportGeneratedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'radiologyOrders',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

radiologyOrderSchema.plugin(auditable);

// The radiologist's worklist, and the scheduling board.
radiologyOrderSchema.index({ status: 1, priority: 1, scheduledFor: 1 });
radiologyOrderSchema.index({ patientId: 1, createdAt: -1 });
radiologyOrderSchema.index({ encounterId: 1, isActive: 1 });
radiologyOrderSchema.index({ modality: 1, status: 1 });

radiologyOrderSchema.pre('save', async function assignOrderNumber(next) {
  if (this.isNew && !this.orderNumber) {
    this.orderNumber = await nextFormattedId('radiologyOrderNumber', 'RAD', 6);
  }
  next();
});

export const RadiologyOrder = mongoose.model('RadiologyOrder', radiologyOrderSchema);
export default RadiologyOrder;
