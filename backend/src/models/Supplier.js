import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const supplierSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    kind: { type: String, enum: ['drug', 'general', 'both'], default: 'both', index: true },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'suppliers',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

supplierSchema.plugin(auditable);

export const Supplier = mongoose.model('Supplier', supplierSchema);
export default Supplier;
