import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFiscalSequence } from '../utils/sequence.js';

const { Schema } = mongoose;

export const CREDIT_NOTE_REASONS = Object.freeze([
  'billing-error',
  'service-not-rendered',
  'duplicate-invoice',
  'rate-correction',
  'scheme-applied-late',
  'insurance-adjustment',
  'goodwill',
  'other',
]);

/**
 * ============================================================================
 * CREDIT NOTE — THE ONLY LAWFUL WAY TO REVERSE AN ISSUED INVOICE
 * ============================================================================
 *
 * Nepal's Inland Revenue Department requires that an issued invoice is never
 * deleted, voided or renumbered. Once a bill has been given to a patient it is
 * part of an unbroken sequence, and the *only* correction is a separate credit
 * note that references it.
 *
 * This is why `Invoice.status` no longer accepts `void` after issue. Voiding
 * looked harmless — the row stayed, it just stopped counting — but to an IRD
 * inspector a sequence with holes in it is indistinguishable from suppressed
 * sales, and that is the finding nobody wants.
 *
 * A credit note may be partial: a patient billed for a test that was never run
 * gets that line credited, not the whole bill reversed.
 */
const creditNoteLineSchema = new Schema(
  {
    /** The invoice line being credited, when the credit is line-specific. */
    lineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem', default: null },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const creditNoteSchema = new Schema(
  {
    /**
     * Sequential within the fiscal year and never reused — the same discipline
     * as invoice numbering, because IRD treats both as tax documents.
     */
    creditNoteNumber: { type: String, unique: true, index: true },
    fiscalYear: { type: String, required: true, index: true },

    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: [true, 'A credit note must reference the invoice it corrects'],
      index: true,
    },
    /** Denormalised so the printed note can name the original without a join. */
    invoiceNumber: { type: String, required: true, trim: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },

    lines: { type: [creditNoteLineSchema], default: [] },

    subtotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },

    reason: { type: String, enum: CREDIT_NOTE_REASONS, required: true },
    /** IRD expects a stated reason; "other" without one is not acceptable. */
    reasonNote: { type: String, trim: true, default: '' },

    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, default: Date.now, index: true },
    /** A credit note above the threshold needs a second signature. */
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },

    /** CBMS sync state — see services/irdService.js. */
    cbms: {
      status: {
        type: String,
        enum: ['pending', 'synced', 'failed', 'not-applicable'],
        default: 'pending',
        index: true,
      },
      syncedAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: '' },
    },
  },
  {
    timestamps: true,
    collection: 'creditNotes',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

creditNoteSchema.plugin(auditable);

creditNoteSchema.index({ patientId: 1, issuedAt: -1 });
creditNoteSchema.index({ fiscalYear: 1, creditNoteNumber: 1 });

creditNoteSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.creditNoteNumber) {
    const { number, fiscalYear } = await nextFiscalSequence('creditNote', 'CN');
    this.creditNoteNumber = number;
    this.fiscalYear = fiscalYear;
  }
  next();
});

/** "other" is only meaningful with an explanation attached. */
creditNoteSchema.path('reasonNote').validate(function requireNoteForOther(value) {
  return this.reason !== 'other' || (value && value.trim().length >= 10);
}, 'Give a reason of at least 10 characters when the credit reason is "other".');

export const CreditNote = mongoose.model('CreditNote', creditNoteSchema);
export default CreditNote;
