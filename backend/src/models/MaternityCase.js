import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const MATERNITY_STATUSES = ['antenatal', 'delivered', 'closed'];

const maternitySchema = new Schema(
  {
    caseNumber: { type: String, unique: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    lmp: { type: Date, required: true },
    edd: { type: Date, required: true, index: true },
    gravida: { type: Number, min: 1, default: 1 },
    para: { type: Number, min: 0, default: 0 },
    abortions: { type: Number, min: 0, default: 0 },
    livingChildren: { type: Number, min: 0, default: 0 },
    bloodGroup: { type: String, trim: true, default: '' },
    highRisk: { type: Boolean, default: false, index: true },
    riskReasons: { type: [String], default: [] },
    status: { type: String, enum: MATERNITY_STATUSES, default: 'antenatal', index: true },
    deliveredAt: { type: Date, default: null },
    outcome: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'maternityCases',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

maternitySchema.plugin(auditable);
maternitySchema.index({ patientId: 1, status: 1 });

maternitySchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.caseNumber) {
    this.caseNumber = await nextFormattedId('maternityNumber', 'ANC', 6);
  }
  next();
});

export const MaternityCase = mongoose.model('MaternityCase', maternitySchema);
export default MaternityCase;
