import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const PO_STATUSES = ['draft', 'submitted', 'partial', 'received', 'cancelled'];
export const PO_TRANSITIONS = Object.freeze({
  draft: ['submitted', 'cancelled'],
  submitted: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: [],
});

const poLineSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    itemCode: { type: String, trim: true, default: '' },
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', default: null },
    quantity: { type: Number, required: true, min: 0.01 },
    quantityReceived: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const purchaseOrderSchema = new Schema(
  {
    poNumber: { type: String, unique: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    status: { type: String, enum: PO_STATUSES, default: 'draft', index: true },
    expectedOn: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
    lines: {
      type: [poLineSchema],
      validate: { validator: (v) => v.length > 0, message: 'A purchase order needs at least one line' },
    },
    submittedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'purchaseOrders',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

purchaseOrderSchema.plugin(auditable);

purchaseOrderSchema.virtual('orderTotal').get(function orderTotal() {
  return (this.lines ?? []).reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
});

purchaseOrderSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.poNumber) {
    this.poNumber = await nextFormattedId('purchaseOrderNumber', 'PO', 6);
  }
  next();
});

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
export default PurchaseOrder;
