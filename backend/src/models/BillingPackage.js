import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const packageItemSchema = new Schema(
  {
    itemCode: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, min: 1, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    taxCode: { type: String, trim: true, default: '' },
    sourceType: {
      type: String,
      enum: ['consultation', 'procedure', 'lab', 'radiology', 'pharmacy', 'other'],
      default: 'procedure',
    },
  },
  { _id: true },
);

const billingPackageSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    items: {
      type: [packageItemSchema],
      validate: { validator: (v) => v.length > 0, message: 'A package needs at least one item' },
    },
  },
  {
    timestamps: true,
    collection: 'billingPackages',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

billingPackageSchema.plugin(auditable);

billingPackageSchema.virtual('packageTotal').get(function packageTotal() {
  return (this.items ?? []).reduce((sum, item) => {
    const line = (item.quantity ?? 1) * (item.unitPrice ?? 0);
    const tax = line * ((item.taxPercent ?? 0) / 100);
    return sum + line + tax;
  }, 0);
});

export const BillingPackage = mongoose.model('BillingPackage', billingPackageSchema);
export default BillingPackage;
