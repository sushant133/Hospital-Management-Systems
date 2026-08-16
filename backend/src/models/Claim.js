import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const CLAIM_STATUSES = [
  'draft',
  'submitted',
  'under-review',
  'approved',
  'partially-approved',
  'rejected',
  'settled',
  'resubmitted',
];

/**
 * Legal forward transitions.
 *
 * A rejected claim is not final: `resubmitted` puts it back in the insurer's
 * hands after the objection is answered, which is how disputes actually run.
 */
export const CLAIM_TRANSITIONS = Object.freeze({
  draft: ['submitted'],
  submitted: ['under-review', 'approved', 'partially-approved', 'rejected'],
  'under-review': ['approved', 'partially-approved', 'rejected'],
  approved: ['settled'],
  'partially-approved': ['settled', 'resubmitted'],
  rejected: ['resubmitted'],
  resubmitted: ['under-review', 'approved', 'partially-approved', 'rejected'],
  settled: [],
});

/**
 * A charge being claimed, snapshotted from the billing ledger.
 *
 * Copied rather than referenced so the claim stays a fixed record of what was
 * submitted — re-pricing a service next year must not silently restate a claim
 * already with the insurer.
 */
const claimLineSchema = new Schema(
  {
    billingLineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem' },
    description: { type: String, required: true, trim: true },
    itemCode: { type: String, trim: true, default: '' },
    sourceType: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 1, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    /** Set when the insurer disallows this specific line. */
    disallowed: { type: Boolean, default: false },
    disallowedReason: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

const claimSchema = new Schema(
  {
    claimNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },

    /**
     * Set once Phase 10 issues invoices. A claim is built from the encounter's
     * charge ledger today; when invoicing lands, the invoice it was raised
     * against is recorded here without changing anything else.
     */
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },

    policyId: { type: Schema.Types.ObjectId, ref: 'PatientPolicy', required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'InsuranceProvider', required: true, index: true },
    /** The advance approval this claim relies on, where one was obtained. */
    preAuthId: { type: Schema.Types.ObjectId, ref: 'PreAuthorization', default: null },

    lines: { type: [claimLineSchema], default: [] },

    /** Gross value of the services claimed. */
    grossAmount: { type: Number, default: 0, min: 0 },
    /** The patient's share under the policy's co-pay. */
    patientResponsible: { type: Number, default: 0, min: 0 },
    /** What is actually being asked of the insurer. */
    claimedAmount: { type: Number, default: 0, min: 0 },

    // --- The insurer's answer ---
    approvedAmount: { type: Number, min: 0, default: 0 },
    settledAmount: { type: Number, min: 0, default: 0 },
    rejectedAmount: { type: Number, min: 0, default: 0 },
    rejectionReason: { type: String, trim: true, default: '' },

    status: { type: String, enum: CLAIM_STATUSES, default: 'draft', index: true },

    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decisionAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },

    /** Insurer's own reference, quoted on correspondence. */
    insurerReference: { type: String, trim: true, default: '' },

    /** Every submission and decision, so a disputed claim can be retraced. */
    history: {
      type: [
        new Schema(
          {
            status: { type: String, required: true },
            at: { type: Date, default: Date.now },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            amount: { type: Number, default: null },
            notes: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'claims',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

claimSchema.plugin(auditable);

claimSchema.index({ patientId: 1, createdAt: -1 });
claimSchema.index({ status: 1, submittedAt: 1 });
claimSchema.index({ providerId: 1, status: 1 });
claimSchema.index({ encounterId: 1, isActive: 1 });

claimSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.claimNumber) {
    this.claimNumber = await nextFormattedId('claimNumber', 'CLM', 6);
  }
  next();
});

/** Still owed by the insurer on an approved claim. */
claimSchema.virtual('outstandingAmount').get(function outstanding() {
  if (!['approved', 'partially-approved', 'settled'].includes(this.status)) return 0;
  return Math.max(0, (this.approvedAmount ?? 0) - (this.settledAmount ?? 0));
});

/**
 * Days since submission — the basis of the aging report. Null until submitted,
 * and frozen once settled.
 */
claimSchema.virtual('ageDays').get(function ageDays() {
  if (!this.submittedAt) return null;
  const end = this.settledAt ? new Date(this.settledAt) : new Date();
  return Math.floor((end - new Date(this.submittedAt)) / 86400000);
});

export const Claim = mongoose.model('Claim', claimSchema);
export default Claim;
