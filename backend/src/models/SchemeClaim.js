import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const SCHEME_CLAIM_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'under-review',
  'approved',
  'partially-approved',
  'rejected',
  'paid',
  'written-off',
]);

/** Forward-only. Anything not listed is refused by the controller. */
export const SCHEME_CLAIM_TRANSITIONS = Object.freeze({
  draft: ['submitted', 'written-off'],
  submitted: ['under-review', 'approved', 'partially-approved', 'rejected'],
  'under-review': ['approved', 'partially-approved', 'rejected'],
  approved: ['paid', 'written-off'],
  'partially-approved': ['paid', 'written-off'],
  rejected: ['submitted', 'written-off'], // resubmission after correction
  paid: [],
  'written-off': [],
});

/**
 * ============================================================================
 * A CLAIM AGAINST A GOVERNMENT SCHEME
 * ============================================================================
 *
 * The receivable that scheme-covered care creates. Without this, free care is
 * indistinguishable from a write-off: the hospital delivers the treatment, the
 * patient pays nothing, and the money the government owes is never asked for.
 *
 * Deliberately separate from the insurance `Claim` model. They look similar but
 * are not: an insurance claim is adjudicated against a policy with a member and
 * a premium, while a scheme claim is a reimbursement request against a public
 * programme, filed in batches on a different cadence, to a different body, in a
 * different format. Forcing them into one model would mean every field is
 * optional and neither workflow is enforceable.
 */
const schemeClaimSchema = new Schema(
  {
    claimNumber: { type: String, unique: true, index: true },

    schemeId: { type: Schema.Types.ObjectId, ref: 'Scheme', required: true, index: true },
    schemeCode: { type: String, required: true, trim: true, index: true },
    entitlementId: { type: Schema.Types.ObjectId, ref: 'PatientEntitlement', required: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },

    /** Fiscal year the episode falls in — how these are batched for filing. */
    fiscalYear: { type: String, required: true, index: true },

    /** What we are asking for. */
    claimedAmount: { type: Number, required: true, min: 0 },
    /** What the scheme agreed. Zero until a decision comes back. */
    approvedAmount: { type: Number, default: 0, min: 0 },
    /** What actually arrived, reconciled from the remittance. */
    paidAmount: { type: Number, default: 0, min: 0 },

    lines: {
      type: [
        new Schema(
          {
            lineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem', required: true },
            description: { type: String, required: true, trim: true },
            serviceCode: { type: String, trim: true, default: '' },
            amount: { type: Number, required: true, min: 0 },
            approvedAmount: { type: Number, default: 0, min: 0 },
            rejectionReason: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    status: { type: String, enum: SCHEME_CLAIM_STATUSES, default: 'draft', index: true },

    /** Deadline derived from the scheme's `claimWindowDays` at creation. */
    fileBy: { type: Date, default: null, index: true },

    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** The batch/reference the paying body gave us on submission. */
    externalReference: { type: String, trim: true, default: '' },

    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '' },
    rejectionReason: { type: String, trim: true, default: '' },

    paidAt: { type: Date, default: null },
    remittanceId: { type: Schema.Types.ObjectId, ref: 'Remittance', default: null },

    writtenOffAt: { type: Date, default: null },
    writtenOffBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    writeOffReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'schemeClaims',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

schemeClaimSchema.plugin(auditable);

schemeClaimSchema.index({ schemeCode: 1, status: 1, fiscalYear: 1 });
schemeClaimSchema.index({ patientId: 1, createdAt: -1 });
// The "what have we not filed yet, and what is about to time out" worklist.
schemeClaimSchema.index({ status: 1, fileBy: 1 });

schemeClaimSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.claimNumber) {
    this.claimNumber = await nextFormattedId('schemeClaim', 'SCL', 6);
  }
  next();
});

/** Still owed to us: approved but not yet received. */
schemeClaimSchema.virtual('outstandingAmount').get(function outstanding() {
  if (['rejected', 'written-off', 'draft'].includes(this.status)) return 0;
  const agreed = this.approvedAmount || this.claimedAmount || 0;
  return Math.max(0, agreed - (this.paidAmount || 0));
});

/** Past its filing deadline and not yet submitted — money about to be lost. */
schemeClaimSchema.virtual('isLapsing').get(function isLapsing() {
  if (!this.fileBy || this.status !== 'draft') return false;
  return new Date(this.fileBy) < new Date();
});

export const SchemeClaim = mongoose.model('SchemeClaim', schemeClaimSchema);
export default SchemeClaim;
