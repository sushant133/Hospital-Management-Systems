import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const POLICY_STATUSES = ['active', 'expired', 'suspended'];

export const RELATIONSHIPS = ['self', 'spouse', 'child', 'parent', 'other'];

/**
 * One patient's cover under one insurer.
 *
 * A patient may hold several concurrent policies — their own and a spouse's,
 * say — which is why this is a collection rather than a field on the patient.
 * The old `patient.insurance` block is superseded by this.
 */
const patientPolicySchema = new Schema(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'A policy must reference a patient'],
      index: true,
    },
    providerId: {
      type: Schema.Types.ObjectId,
      ref: 'InsuranceProvider',
      required: [true, 'A policy must reference an insurer'],
      index: true,
    },

    policyNumber: { type: String, required: [true, 'Policy number is required'], trim: true },
    planName: { type: String, trim: true, default: '' },

    /** The principal member, who may not be the patient. */
    memberName: { type: String, trim: true, default: '' },
    relationshipToMember: { type: String, enum: RELATIONSHIPS, default: 'self' },

    /**
     * The patient's share. Null means "use the provider's default" — stored as
     * null rather than copied, so changing the insurer's terms flows through to
     * every policy that never set its own.
     */
    coPayPercent: { type: Number, min: 0, max: 100, default: null },

    /** Maximum the insurer will pay across the policy year. 0 = unlimited. */
    coverageLimit: { type: Number, min: 0, default: 0 },
    /** Running total the insurer has approved against this policy. */
    coverageUsed: { type: Number, min: 0, default: 0 },

    validFrom: { type: Date, required: [true, 'A start date is required'] },
    validTill: { type: Date, required: [true, 'An expiry date is required'] },

    status: { type: String, enum: POLICY_STATUSES, default: 'active', index: true },

    /**
     * Eligibility is *verified*, not assumed. A policy that has never been
     * checked against the insurer is still usable, but the desk can see that
     * nobody has confirmed it.
     */
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verificationNotes: { type: String, trim: true, default: '' },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'patientPolicies',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

patientPolicySchema.plugin(auditable);

patientPolicySchema.index({ patientId: 1, status: 1 });
patientPolicySchema.index({ providerId: 1, policyNumber: 1 }, { unique: true });

patientPolicySchema.pre('validate', function checkDates(next) {
  if (this.validFrom && this.validTill && this.validTill <= this.validFrom) {
    return next(new Error('The expiry date must be after the start date'));
  }
  return next();
});

/** In force today: active, and within its dates. */
patientPolicySchema.virtual('isCurrentlyValid').get(function isCurrentlyValid() {
  if (this.status !== 'active') return false;
  const now = new Date();
  return this.validFrom <= now && this.validTill >= now;
});

/** What is left of the annual limit. Infinity when the policy is uncapped. */
patientPolicySchema.virtual('coverageRemaining').get(function coverageRemaining() {
  if (!this.coverageLimit) return Infinity;
  return Math.max(0, this.coverageLimit - (this.coverageUsed ?? 0));
});

export const PatientPolicy = mongoose.model('PatientPolicy', patientPolicySchema);
export default PatientPolicy;
