import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const BLOOD_COMPONENTS = ['wb', 'prbc', 'ffp', 'platelet', 'cryo'];
export const UNIT_STATUSES = ['available', 'reserved', 'issued', 'discarded', 'expired'];

const bloodUnitSchema = new Schema(
  {
    bagNumber: { type: String, unique: true, index: true },
    group: { type: String, required: true, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], index: true },
    component: { type: String, enum: BLOOD_COMPONENTS, required: true, index: true },
    collectedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    volumeMl: { type: Number, min: 0, default: 350 },
    donorRef: { type: String, trim: true, default: '' },
    status: { type: String, enum: UNIT_STATUSES, default: 'available', index: true },
    reservedForRequestId: { type: Schema.Types.ObjectId, ref: 'BloodRequest', default: null },
    issuedToPatientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'bloodUnits',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

bloodUnitSchema.plugin(auditable);

bloodUnitSchema.pre('save', async function assignBag(next) {
  if (this.isNew && !this.bagNumber) {
    this.bagNumber = await nextFormattedId('bloodBagNumber', 'BB', 6);
  }
  next();
});

export const BloodUnit = mongoose.model('BloodUnit', bloodUnitSchema);
export default BloodUnit;
