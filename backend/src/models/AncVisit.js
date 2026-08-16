import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const ancVisitSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'MaternityCase', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    visitNumber: { type: Number, required: true, min: 1 },
    visitedAt: { type: Date, default: Date.now, index: true },
    weightKg: { type: Number, min: 0 },
    systolicBp: { type: Number, min: 0 },
    diastolicBp: { type: Number, min: 0 },
    fundalHeightCm: { type: Number, min: 0 },
    fetalHeartBpm: { type: Number, min: 0 },
    haemoglobin: { type: Number, min: 0 },
    urineProtein: { type: String, trim: true, default: '' },
    complaints: { type: String, trim: true, default: '' },
    nextVisitOn: { type: Date, default: null },
    seenBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'ancVisits',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

ancVisitSchema.plugin(auditable);
ancVisitSchema.index({ caseId: 1, visitNumber: 1 }, { unique: true });

export const AncVisit = mongoose.model('AncVisit', ancVisitSchema);
export default AncVisit;
