import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const PREAUTH_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'partially-approved',
  'rejected',
  'expired',
];

/** Legal forward transitions. The controller refuses anything not listed here. */
export const PREAUTH_TRANSITIONS = Object.freeze({
  draft: ['submitted'],
  submitted: ['approved', 'partially-approved', 'rejected'],
  approved: ['expired'],
  'partially-approved': ['expired'],
  rejected: [],
  expired: [],
});

const requestedServiceSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    estimatedAmount: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

/**
 * Permission asked of the insurer *before* an expensive service is given.
 *
 * Distinct from a claim, which comes after: a pre-authorisation is a promise to
 * pay, and its `authorizationCode` is what a later claim quotes as evidence
 * that the promise was made.
 */
const preAuthorizationSchema = new Schema(
  {
    preAuthNumber: { type: String, unique: true, index: true },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: true,
      index: true,
    },
    policyId: {
      type: Schema.Types.ObjectId,
      ref: 'PatientPolicy',
      required: [true, 'A pre-authorisation must name the policy it is against'],
      index: true,
    },
    providerId: { type: Schema.Types.ObjectId, ref: 'InsuranceProvider', required: true, index: true },

    requestedServices: {
      type: [requestedServiceSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'List at least one service being requested',
      },
    },
    estimatedTotal: { type: Number, default: 0, min: 0 },

    clinicalJustification: { type: String, trim: true, default: '' },

    status: { type: String, enum: PREAUTH_STATUSES, default: 'draft', index: true },

    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // --- The insurer's answer ---
    approvedAmount: { type: Number, min: 0, default: 0 },
    /** Quoted on the claim as evidence the insurer agreed in advance. */
    authorizationCode: { type: String, trim: true, default: '' },
    /** An approval is not open-ended; after this the service must be re-authorised. */
    validUntil: { type: Date, default: null },
    decisionAt: { type: Date, default: null },
    decisionBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNotes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'preAuthorizations',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

preAuthorizationSchema.plugin(auditable);

preAuthorizationSchema.index({ patientId: 1, createdAt: -1 });
preAuthorizationSchema.index({ status: 1, submittedAt: -1 });
preAuthorizationSchema.index({ policyId: 1, status: 1 });

preAuthorizationSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.preAuthNumber) {
    this.preAuthNumber = await nextFormattedId('preAuthNumber', 'PA', 6);
  }
  next();
});

/** The estimate is always the sum of the services asked for. */
preAuthorizationSchema.pre('validate', function computeTotal(next) {
  if (Array.isArray(this.requestedServices)) {
    const total = this.requestedServices.reduce(
      (sum, service) => sum + Number(service.estimatedAmount ?? 0),
      0,
    );
    this.estimatedTotal = Math.round(total * 100) / 100;
  }
  next();
});

/** True when an approval has run out of time. */
preAuthorizationSchema.virtual('isExpired').get(function isExpired() {
  if (!this.validUntil) return false;
  if (!['approved', 'partially-approved'].includes(this.status)) return false;
  return new Date(this.validUntil) < new Date();
});

/** Usable on a claim: approved (in whole or part) and still in date. */
preAuthorizationSchema.virtual('isUsable').get(function isUsable() {
  return ['approved', 'partially-approved'].includes(this.status) && !this.isExpired;
});

export const PreAuthorization = mongoose.model('PreAuthorization', preAuthorizationSchema);
export default PreAuthorization;
