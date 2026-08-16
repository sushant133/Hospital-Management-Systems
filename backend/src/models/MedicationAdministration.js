import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const MAR_STATUSES = ['given', 'held', 'refused', 'missed'];

/**
 * One administration of one prescribed item. The eMAR: nurses chart what was
 * actually given, which is not the same as what pharmacy dispensed.
 */
const medicationAdministrationSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', required: true, index: true },
    prescriptionItemId: { type: Schema.Types.ObjectId, required: true },

    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', default: null },
    drugName: { type: String, required: true, trim: true },
    dose: { type: String, required: true, trim: true },
    route: { type: String, trim: true, default: 'oral' },

    status: { type: String, enum: MAR_STATUSES, required: true, index: true },
    scheduledAt: { type: Date, default: null },
    administeredAt: { type: Date, default: Date.now, index: true },
    administeredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    reason: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'medicationAdministrations',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

medicationAdministrationSchema.plugin(auditable);
medicationAdministrationSchema.index({ encounterId: 1, administeredAt: -1 });
medicationAdministrationSchema.index({ patientId: 1, administeredAt: -1 });

export const MedicationAdministration = mongoose.model(
  'MedicationAdministration',
  medicationAdministrationSchema,
);
export default MedicationAdministration;
