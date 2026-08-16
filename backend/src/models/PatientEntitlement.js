import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const ENTITLEMENT_STATUSES = Object.freeze([
  'active',
  'expired',
  'suspended',
  'revoked',
]);

/**
 * ============================================================================
 * A PATIENT'S CLAIM ON A SCHEME
 * ============================================================================
 *
 * Separate from `Scheme` (what the scheme *is*) and from `SchemeClaim` (a
 * request for money against one episode). This is the standing fact: "this
 * person holds a senior citizen card, number X, verified by Y on Z".
 *
 * It exists as its own collection rather than as fields on the patient because
 * a patient may hold several entitlements at once, each with its own card,
 * validity and drawn-down balance — and because the *verification* of each one
 * is an audited act with an actor and a document behind it.
 */
const patientEntitlementSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    schemeId: { type: Schema.Types.ObjectId, ref: 'Scheme', required: true, index: true },
    /** Denormalised so eligibility checks avoid a join on the hot path. */
    schemeCode: { type: String, required: true, trim: true, index: true },

    /** The card or certificate number that proves the entitlement. */
    documentNumber: { type: String, trim: true, default: '' },
    documentIssuedBy: { type: String, trim: true, default: '' },
    documentIssuedOn: { type: Date, default: null },
    /** Scan of the card. Served only through authenticated download routes. */
    documentPath: { type: String, trim: true, default: '' },

    /**
     * Who sighted the physical card, and when.
     *
     * Not optional in practice: applying free care on an unverified claim is
     * the finding every scheme audit looks for, and "the receptionist said so"
     * is not a defence. `verifiedBy` is what makes the decision attributable.
     */
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    verificationNote: { type: String, trim: true, default: '' },

    status: { type: String, enum: ENTITLEMENT_STATUSES, default: 'active', index: true },

    validFrom: { type: Date, default: Date.now },
    validTo: { type: Date, default: null },

    /**
     * Drawn down against the scheme's ceiling within the current period.
     *
     * Maintained by `schemeService` as claims are raised, so the counter can
     * answer "how much of this patient's Bipanna Nagarik ceiling is left"
     * BEFORE treatment rather than after billing. That ordering is the whole
     * point — a patient told at discharge that their ceiling ran out three days
     * ago has a bill nobody can pay.
     */
    utilisedAmount: { type: Number, default: 0, min: 0 },
    /** The period the utilisation figure belongs to ("2081-82", or "lifetime"). */
    utilisationPeriod: { type: String, default: '', index: true },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revokeReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'patientEntitlements',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

patientEntitlementSchema.plugin(auditable);

// One live entitlement per patient per scheme; history is kept by status.
patientEntitlementSchema.index(
  { patientId: 1, schemeCode: 1, status: 1 },
  { partialFilterExpression: { status: 'active' } },
);
patientEntitlementSchema.index({ validTo: 1, status: 1 });

/** Usable right now: active, verified where required, and inside its dates. */
patientEntitlementSchema.methods.isUsableOn = function isUsableOn(date = new Date()) {
  if (this.status !== 'active') return false;
  if (this.validFrom && new Date(this.validFrom) > date) return false;
  if (this.validTo && new Date(this.validTo) < date) return false;
  return true;
};

export const PatientEntitlement = mongoose.model('PatientEntitlement', patientEntitlementSchema);
export default PatientEntitlement;
