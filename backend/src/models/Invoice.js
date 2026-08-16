import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFiscalSequence } from '../utils/sequence.js';

const { Schema } = mongoose;

export const INVOICE_STATUSES = ['draft', 'issued', 'partially-paid', 'paid', 'cancelled', 'credited'];

export const DISCOUNT_STATUSES = ['none', 'pending', 'approved', 'rejected'];

/**
 * Legal forward transitions. The controller refuses anything not listed here.
 *
 * ---------------------------------------------------------------------------
 * WHY `void` IS GONE
 * ---------------------------------------------------------------------------
 * An issued invoice in Nepal cannot be voided. It has been given to a patient,
 * it carries a number from an unbroken fiscal-year sequence, and IRD treats a
 * hole in that sequence as a suppressed sale. The only lawful reversal is a
 * separate credit note that references it (see models/CreditNote.js), which is
 * what `credited` records.
 *
 * `cancelled` survives for DRAFTS only — a bill that was never issued was never
 * a tax document, consumed no number, and may simply be abandoned.
 */
export const INVOICE_TRANSITIONS = Object.freeze({
  draft: ['issued', 'cancelled'],
  issued: ['partially-paid', 'paid', 'credited'],
  'partially-paid': ['paid', 'credited'],
  paid: ['credited'],
  cancelled: [],
  credited: [],
});

/**
 * Taxability of a charge line under Nepali VAT.
 *
 * Most hospital services are VAT-exempt, but a hospital is not uniformly
 * exempt — pharmacy retail, cafeteria sales and diagnostics sold to third
 * parties can be taxable supplies. Carrying one global tax percent (the old
 * `HOSPITAL_TAX_PERCENT`) either over-taxes exempt care or under-taxes the
 * shop, and both are findings. So taxability is a property of the charge.
 *
 * CONFIRM THE CLASSIFICATION OF YOUR OWN SERVICES WITH YOUR AUDITOR — the
 * boundary moves, and it is the hospital that carries the liability.
 */
export const TAX_CATEGORIES = Object.freeze({
  EXEMPT: 'exempt', // health services — no VAT
  TAXABLE: 'taxable', // standard rate
  ZERO_RATED: 'zero-rated', // exports; rare in a hospital
  NON_TAXABLE: 'non-taxable', // outside VAT scope entirely (e.g. deposits)
});

export const TAX_CATEGORY_VALUES = Object.freeze(Object.values(TAX_CATEGORIES));

/**
 * A consolidated bill for one encounter.
 *
 * **Line items are NOT embedded.** They live in `billingLineItems` and point
 * back through `invoiceId` — the ledger is the single place a charge exists,
 * and copying lines onto the invoice would create a second version of the truth
 * that could drift from it.
 *
 * Every money field here is DERIVED from that ledger and from `payments` by
 * `services/invoiceService.js`. Nothing writes them by hand.
 */
const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, unique: true, index: true },

    // Patient and encounter are both required.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'An invoice must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'An invoice must reference an encounter'],
      index: true,
    },

    /** Sum of the line items pulled onto this invoice. */
    subtotal: { type: Number, default: 0, min: 0 },

    // --- Discount: requested by one person, authorised by another ---
    discountStatus: { type: String, enum: DISCOUNT_STATUSES, default: 'none', index: true },
    /** Only ever non-zero once approved — a requested discount does not reduce the bill. */
    discountAmount: { type: Number, default: 0, min: 0 },
    /** What was asked for, held separately until someone authorises it. */
    discountRequested: { type: Number, default: 0, min: 0 },
    discountReason: { type: String, trim: true, default: '' },
    discountRequestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    discountRequestedAt: { type: Date, default: null },
    discountApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    discountApprovedAt: { type: Date, default: null },
    discountDecisionNotes: { type: String, trim: true, default: '' },

    // --- Tax (A8: IRD) ---
    /** Value of lines classified `taxable`, after discount. */
    taxableAmount: { type: Number, default: 0, min: 0 },
    /** Value of lines classified `exempt` — the bulk of a hospital bill. */
    exemptAmount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },

    /** subtotal − discount + tax. */
    total: { type: Number, default: 0, min: 0 },

    // --- Scheme and entitlement coverage (A7) ---
    /**
     * Borne by a government scheme (senior citizen, Bipanna Nagarik, free
     * dialysis, Aama Surakshya…). This is a receivable from government, not a
     * discount — a discount is money forgone, this is money owed to the
     * hospital by someone other than the patient.
     */
    schemeCoveredAmount: { type: Number, default: 0, min: 0 },
    /** Which schemes contributed, so the claim register can be rebuilt. */
    schemeBreakdown: {
      type: [
        new Schema(
          {
            schemeId: { type: Schema.Types.ObjectId, ref: 'Scheme', required: true },
            schemeCode: { type: String, required: true, trim: true },
            amount: { type: Number, required: true, min: 0 },
            claimId: { type: Schema.Types.ObjectId, ref: 'SchemeClaim', default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Agreed by an insurer against this encounter (Phase 11 claims / HIB). */
    insuranceCoveredAmount: { type: Number, default: 0, min: 0 },
    /** What the patient owes: total − insurer share − scheme share. */
    patientResponsibleAmount: { type: Number, default: 0, min: 0 },

    /** Net of payments and refunds. */
    amountPaid: { type: Number, default: 0 },
    /** patientResponsible − amountPaid. */
    balance: { type: Number, default: 0 },

    status: { type: String, enum: INVOICE_STATUSES, default: 'draft', index: true },

    issuedAt: { type: Date, default: null },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dueDate: { type: Date, default: null },

    paidAt: { type: Date, default: null },

    /**
     * Fiscal year this invoice's number belongs to ("2081-82"). Set together
     * with the number at issue time and never changed — the pair is what makes
     * the sequence auditable.
     */
    fiscalYear: { type: String, default: '', index: true },

    /** Credit notes raised against this invoice (A8). */
    creditNoteIds: { type: [Schema.Types.ObjectId], ref: 'CreditNote', default: [] },
    creditedAmount: { type: Number, default: 0, min: 0 },

    /** Draft-only abandonment. An issued invoice can never reach this. */
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, trim: true, default: '' },

    /**
     * CBMS (IRD Central Billing Monitoring System) sync state.
     *
     * Deliberately a state machine on the document rather than fire-and-forget:
     * a clinic loses internet regularly, the bill must still print, and the
     * sync must retry until it lands. `pending` rows are the outbox.
     */
    cbms: {
      status: {
        type: String,
        enum: ['pending', 'synced', 'failed', 'not-applicable'],
        default: 'not-applicable',
        index: true,
      },
      syncedAt: { type: Date, default: null },
      /** The reference IRD returns on a successful sync. */
      reference: { type: String, default: '' },
      attempts: { type: Number, default: 0 },
      lastAttemptAt: { type: Date, default: null },
      lastError: { type: String, default: '' },
    },

    /** Printed on the bill: whether this is a tax invoice or an abbreviated one. */
    documentType: {
      type: String,
      enum: ['tax-invoice', 'abbreviated-tax-invoice'],
      default: 'abbreviated-tax-invoice',
    },
    /** The patient's or company's PAN, when they need a full tax invoice. */
    buyerPan: { type: String, trim: true, default: '' },
    buyerName: { type: String, trim: true, default: '' },

    /**
     * Set once the bill is printed. IRD requires a reprint to be marked as a
     * copy, so the first print is recorded and every later one is a duplicate.
     */
    printCount: { type: Number, default: 0, min: 0 },
    firstPrintedAt: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'invoices',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

invoiceSchema.plugin(auditable);

invoiceSchema.index({ patientId: 1, createdAt: -1 });
invoiceSchema.index({ encounterId: 1, isActive: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
// The CBMS outbox drain and the sequence-gap audit.
invoiceSchema.index({ 'cbms.status': 1, issuedAt: 1 });
invoiceSchema.index({ fiscalYear: 1, invoiceNumber: 1 });

/**
 * The number is allocated AT ISSUE, not at creation.
 *
 * A draft is not a tax document — it can be edited, abandoned, or never given
 * to anyone. Numbering it on create would burn a number from the fiscal-year
 * sequence every time a cashier opened a bill and changed their mind, and each
 * one of those becomes a hole an IRD inspector has to be talked through.
 *
 * So: drafts have no number. `issue()` in invoiceService assigns one, and from
 * that moment the row is immutable in every field that appears on the printed
 * bill.
 */
invoiceSchema.pre('save', async function assignNumberOnIssue(next) {
  const becomingIssued = this.isModified('status') && this.status === 'issued';
  if (becomingIssued && !this.invoiceNumber) {
    const { number, fiscalYear } = await nextFiscalSequence('invoice', 'INV', {
      asOf: this.issuedAt || new Date(),
    });
    this.invoiceNumber = number;
    this.fiscalYear = fiscalYear;
  }
  next();
});

/**
 * An issued invoice's number, fiscal year and totals are frozen.
 *
 * Payments and credit notes change what is *owed*, but they never rewrite the
 * document that was handed to the patient. Enforced at the model so no
 * controller, script or migration can quietly restate a tax document.
 */
const FROZEN_AFTER_ISSUE = [
  'invoiceNumber',
  'fiscalYear',
  'subtotal',
  'discountAmount',
  'taxableAmount',
  'exemptAmount',
  'taxPercent',
  'taxAmount',
  'total',
  'patientId',
  'encounterId',
  'issuedAt',
];

invoiceSchema.pre('save', function freezeIssuedDocument(next) {
  if (this.isNew) return next();
  // Only guard rows that were already issued before this save began.
  const wasIssued = Boolean(this.invoiceNumber) && this.status !== 'draft';
  if (!wasIssued) return next();

  const rewritten = FROZEN_AFTER_ISSUE.filter((path) => this.isModified(path));
  if (rewritten.length > 0) {
    return next(
      new Error(
        `Invoice ${this.invoiceNumber} is issued; ${rewritten.join(', ')} cannot be changed. ` +
          'Raise a credit note instead.',
      ),
    );
  }
  return next();
});

/** Past its due date with money still owed. */
invoiceSchema.virtual('isOverdue').get(function isOverdue() {
  if (!this.dueDate || this.balance <= 0) return false;
  if (['paid', 'cancelled', 'credited', 'draft'].includes(this.status)) return false;
  return new Date(this.dueDate) < new Date();
});

/** Net of credit notes — what this invoice actually stands at today. */
invoiceSchema.virtual('effectiveTotal').get(function effectiveTotal() {
  return Math.max(0, (this.total || 0) - (this.creditedAmount || 0));
});

/** Days since it was issued, for receivables aging. */
invoiceSchema.virtual('ageDays').get(function ageDays() {
  if (!this.issuedAt) return null;
  const end = this.paidAt ? new Date(this.paidAt) : new Date();
  return Math.floor((end - new Date(this.issuedAt)) / 86400000);
});

export const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
