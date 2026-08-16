import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const immunizationSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    vaccineCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    vaccineName: { type: String, required: true, trim: true },
    doseNumber: { type: Number, min: 1, default: 1 },
    givenAt: { type: Date, default: Date.now, index: true },
    site: { type: String, trim: true, default: '' },
    route: { type: String, trim: true, default: 'im' },
    batchNo: { type: String, trim: true, default: '' },
    manufacturer: { type: String, trim: true, default: '' },
    givenBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'immunizations',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

immunizationSchema.plugin(auditable);
immunizationSchema.index({ patientId: 1, vaccineCode: 1, doseNumber: 1 });

export const Immunization = mongoose.model('Immunization', immunizationSchema);
export default Immunization;
