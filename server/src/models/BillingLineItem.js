import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/**
 * SHARED billing ledger. Every revenue-generating module (lab, radiology,
 * pharmacy, bed charges, consultations) writes its charges here as they are
 * incurred — no module builds its own invoice.
 *
 * Phase 8 invoicing consumes this collection: it selects
 *   { encounterId, status: 'unbilled', isActive: true }
 * sums the rows into an `invoices` document, then flips them to
 * status:'invoiced' with the invoiceId back-reference.
 *
 * This replaces the embedded `invoices.lineItems[]` array originally sketched
 * in ARCHITECTURE.md: charges accrue continuously throughout an encounter and
 * must be writable before any invoice exists.
 */

export const CHARGE_SOURCE_TYPES = [
  'lab',
  'radiology',
  'pharmacy',
  'bed',
  'procedure',
  'consultation',
  'other',
];

export const LINE_ITEM_STATUSES = ['unbilled', 'invoiced', 'cancelled'];

const billingLineItemSchema = new Schema(
  {
    // Per ARCHITECTURE.md §3, every financial artifact carries BOTH.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Billing line must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'Billing line must reference an encounter'],
      index: true,
    },

    sourceType: { type: String, enum: CHARGE_SOURCE_TYPES, required: true, index: true },

    /** The document that generated the charge, e.g. a labOrders._id. */
    sourceId: { type: Schema.Types.ObjectId, default: null, index: true },

    /** Human-readable origin reference, e.g. 'LAB-000012'. */
    sourceRef: { type: String, trim: true, default: '' },

    /** Charge code — the lab test code, drug code, etc. */
    itemCode: { type: String, trim: true, default: '' },
    description: { type: String, required: true, trim: true },

    quantity: { type: Number, required: true, min: 0, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },

    /** Owning department, for revenue reporting in Phase 10. */
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },

    status: { type: String, enum: LINE_ITEM_STATUSES, default: 'unbilled', index: true },

    /** Set by Phase 8 when the line is pulled onto an invoice. */
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },

    chargedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'billingLineItems',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

billingLineItemSchema.plugin(auditable);

// The query Phase 8 invoicing runs.
billingLineItemSchema.index({ encounterId: 1, status: 1, isActive: 1 });
billingLineItemSchema.index({ patientId: 1, chargedAt: -1 });
// Lets a source module find (and reverse) the charges it created.
billingLineItemSchema.index({ sourceType: 1, sourceId: 1 });

/** lineTotal is always derived — never trust a client-supplied total. */
billingLineItemSchema.pre('validate', function computeLineTotal(next) {
  const quantity = Number(this.quantity ?? 0);
  const unitPrice = Number(this.unitPrice ?? 0);
  this.lineTotal = Math.round(quantity * unitPrice * 100) / 100;
  next();
});

export const BillingLineItem = mongoose.model('BillingLineItem', billingLineItemSchema);
export default BillingLineItem;
