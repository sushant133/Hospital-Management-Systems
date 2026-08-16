import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const CONSENT_PURPOSES = ['treatment', 'referral', 'research', 'hie'];
export const CONSENT_STATUSES = ['active', 'revoked', 'expired'];

/**
 * A recorded consent artefact. Not a certified ABDM consent manager —
 * it is the hospital-side record that an export or referral was allowed.
 */
const consentSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    purpose: { type: String, enum: CONSENT_PURPOSES, required: true },
    status: { type: String, enum: CONSENT_STATUSES, default: 'active', index: true },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    scope: { type: String, trim: true, default: 'encounter' },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    notes: { type: String, trim: true, default: '' },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'consents',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

consentSchema.plugin(auditable);
consentSchema.index({ patientId: 1, purpose: 1, status: 1 });

export const Consent = mongoose.model('Consent', consentSchema);
export default Consent;
