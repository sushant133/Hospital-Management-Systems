import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/**
 * An insurer the hospital bills.
 *
 * The defaults here are the fallback for a policy that does not override them:
 * a provider's standard co-pay and settlement terms apply unless the patient's
 * particular plan says otherwise.
 */
const insuranceProviderSchema = new Schema(
  {
    code: {
      type: String,
      required: [true, 'Provider code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Provider name is required'], trim: true },

    /**
     * A TPA desks the hospital's corporate/cashless work; an insurer is billed
     * directly. Same collection because the claim lifecycle is identical.
     */
    kind: { type: String, enum: ['insurer', 'tpa'], default: 'insurer', index: true },

    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    /** Where claims are sent — often different from the general contact. */
    claimSubmissionEmail: { type: String, trim: true, lowercase: true, default: '' },

    /** Applied when the patient's policy does not set its own. */
    defaultCoPayPercent: { type: Number, min: 0, max: 100, default: 20 },

    /**
     * Contractual days to settle. Aging reports measure against this, so a
     * claim is "overdue" by the insurer's own terms rather than a guess.
     */
    settlementDays: { type: Number, min: 0, max: 365, default: 30 },

    /** Services this insurer never covers, matched against charge descriptions. */
    exclusions: { type: [String], default: [] },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'insuranceProviders',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

insuranceProviderSchema.plugin(auditable);

insuranceProviderSchema.index({ name: 1 });

export const InsuranceProvider = mongoose.model('InsuranceProvider', insuranceProviderSchema);
export default InsuranceProvider;
