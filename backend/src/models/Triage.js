import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/** Emergency Severity Index — 1 is immediately life-threatening. */
export const ESI_LEVELS = [1, 2, 3, 4, 5];

export const TRIAGE_STATUSES = ['waiting', 'in-bay', 'admitted', 'discharged', 'lwbs', 'transferred'];

const triageSchema = new Schema(
  {
    triageNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null, index: true },

    arrivedAt: { type: Date, default: Date.now, index: true },
    chiefComplaint: { type: String, required: true, trim: true },
    esi: { type: Number, enum: ESI_LEVELS, required: true, index: true },
    mechanism: { type: String, trim: true, default: '' },

    vitals: {
      temperatureC: { type: Number },
      pulseBpm: { type: Number },
      respiratoryRate: { type: Number },
      systolicBp: { type: Number },
      diastolicBp: { type: Number },
      spo2: { type: Number },
      gcs: { type: Number, min: 3, max: 15 },
    },

    trauma: {
      isTrauma: { type: Boolean, default: false },
      airway: { type: String, trim: true, default: '' },
      breathing: { type: String, trim: true, default: '' },
      circulation: { type: String, trim: true, default: '' },
      disability: { type: String, trim: true, default: '' },
      exposure: { type: String, trim: true, default: '' },
    },

    notes: { type: String, trim: true, default: '' },
    status: { type: String, enum: TRIAGE_STATUSES, default: 'waiting', index: true },

    triagedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    seenAt: { type: Date, default: null },
    dispositionAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'triageAssessments',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

triageSchema.plugin(auditable);
triageSchema.index({ status: 1, esi: 1, arrivedAt: 1 });

triageSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.triageNumber) {
    this.triageNumber = await nextFormattedId('triageNumber', 'ER', 6);
  }
  next();
});

triageSchema.virtual('waitMinutes').get(function waitMinutes() {
  const end = this.seenAt || this.dispositionAt || new Date();
  return Math.max(0, Math.round((end - this.arrivedAt) / 60000));
});

export const Triage = mongoose.model('Triage', triageSchema);
export default Triage;
