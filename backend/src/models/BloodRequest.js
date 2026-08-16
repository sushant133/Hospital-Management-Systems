import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { BLOOD_COMPONENTS } from './BloodUnit.js';

const { Schema } = mongoose;

export const BLOOD_REQUEST_STATUSES = ['requested', 'crossmatched', 'issued', 'cancelled', 'fulfilled'];

const bloodRequestSchema = new Schema(
  {
    requestNumber: { type: String, unique: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    group: { type: String, required: true, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    component: { type: String, enum: BLOOD_COMPONENTS, required: true },
    unitsRequested: { type: Number, min: 1, default: 1 },
    indication: { type: String, required: true, trim: true },
    priority: { type: String, enum: ['routine', 'urgent', 'stat'], default: 'routine' },
    status: { type: String, enum: BLOOD_REQUEST_STATUSES, default: 'requested', index: true },
    reservedUnitIds: { type: [Schema.Types.ObjectId], ref: 'BloodUnit', default: [] },
    issuedUnitIds: { type: [Schema.Types.ObjectId], ref: 'BloodUnit', default: [] },
    crossmatchNote: { type: String, trim: true, default: '' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'bloodRequests',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

bloodRequestSchema.plugin(auditable);

bloodRequestSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.requestNumber) {
    this.requestNumber = await nextFormattedId('bloodRequestNumber', 'BR', 6);
  }
  next();
});

export const BloodRequest = mongoose.model('BloodRequest', bloodRequestSchema);
export default BloodRequest;
