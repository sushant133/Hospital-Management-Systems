import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

export const BED_STATUSES = ['available', 'occupied', 'reserved', 'maintenance', 'cleaning'];

const bedSchema = new mongoose.Schema(
  {
    bedNumber: { type: String, required: [true, 'Bed number is required'], trim: true },

    wardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      required: [true, 'Bed must belong to a ward'],
      index: true,
    },

    status: { type: String, enum: BED_STATUSES, default: 'available', index: true },

    // Set when a patient is admitted to this bed (Phase 3 wires the workflow).
    currentPatientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    currentEncounterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Encounter', default: null },

    dailyRate: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'beds',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

bedSchema.plugin(auditable);

// A bed number is unique within its ward, not globally.
bedSchema.index({ wardId: 1, bedNumber: 1 }, { unique: true });
bedSchema.index({ status: 1, isActive: 1 });

export const Bed = mongoose.model('Bed', bedSchema);
export default Bed;
