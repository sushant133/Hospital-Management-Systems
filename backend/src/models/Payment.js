import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const PAYMENT_TYPES = ['payment', 'refund', 'credit-note'];

export const PAYMENT_METHODS = ['cash', 'card', 'insurance', 'transfer', 'wallet', 'cheque'];

/**
 * Money moving against an invoice.
 *
 * **Refunds and credit notes are negative rows, never edits.** Reversing money
 * that has already moved by rewriting the original payment would destroy the
 * record that it happened; instead a new row carries a negative amount and
 * points at what it reverses through `reversalOf`. The invoice's `amountPaid`
 * is the sum of the rows, so the arithmetic works out without either row lying.
 *
 * The same instinct as clinical notes (§5): correct by appending, not by
 * overwriting.
 */
const paymentSchema = new Schema(
  {
    paymentNumber: { type: String, unique: true, index: true },

    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: [true, 'A payment must reference an invoice'],
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },

    type: { type: String, enum: PAYMENT_TYPES, default: 'payment', required: true, index: true },

    /** Positive for a payment, negative for a refund or credit note. */
    amount: { type: Number, required: [true, 'An amount is required'] },

    method: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    /** Transaction id, cheque number, insurer payment reference. */
    reference: { type: String, trim: true, default: '' },
    /** Required on a refund or credit note. */
    reason: { type: String, trim: true, default: '' },

    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedAt: { type: Date, default: () => new Date(), index: true },

    /** The payment this row reverses. Null on an ordinary payment. */
    reversalOf: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'payments',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

paymentSchema.plugin(auditable);

paymentSchema.index({ invoiceId: 1, receivedAt: -1 });
paymentSchema.index({ patientId: 1, receivedAt: -1 });
paymentSchema.index({ type: 1, receivedAt: -1 });

paymentSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.paymentNumber) {
    const prefix = this.type === 'payment' ? 'PAY' : 'CRN';
    this.paymentNumber = await nextFormattedId(
      this.type === 'payment' ? 'paymentNumber' : 'creditNoteNumber',
      prefix,
      6,
    );
  }
  next();
});

/** The sign must match the type, or the invoice totals silently go wrong. */
paymentSchema.pre('validate', function checkSign(next) {
  if (this.type === 'payment' && this.amount <= 0) {
    return next(new Error('A payment must be a positive amount'));
  }
  if (['refund', 'credit-note'].includes(this.type)) {
    if (this.amount >= 0) {
      return next(new Error(`A ${this.type} must be a negative amount`));
    }
    if (!(this.reason ?? '').trim()) {
      return next(new Error(`A ${this.type} must state a reason`));
    }
  }
  return next();
});

export const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
