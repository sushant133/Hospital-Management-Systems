import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const facilitySchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['hospital', 'clinic', 'lab', 'pharmacy'], default: 'hospital' },
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    isDefault: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: 'facilities',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

facilitySchema.plugin(auditable);

export const Facility = mongoose.model('Facility', facilitySchema);
export default Facility;
