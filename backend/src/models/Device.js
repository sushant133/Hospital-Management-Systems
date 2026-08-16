import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const DEVICE_KINDS = ['analyzer', 'modality', 'monitor', 'other'];

const deviceSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: DEVICE_KINDS, default: 'analyzer', index: true },
    manufacturer: { type: String, trim: true, default: '' },
    model: { type: String, trim: true, default: '' },
    sendingApplication: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    lastSeenAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'devices',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

deviceSchema.plugin(auditable);

export const Device = mongoose.model('Device', deviceSchema);
export default Device;
