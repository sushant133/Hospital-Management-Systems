import mongoose from 'mongoose';
import crypto from 'node:crypto';

const { Schema } = mongoose;

/**
 * ============================================================================
 * ACTIVE SESSIONS (D3)
 * ============================================================================
 *
 * Auth already had per-account lockout, IP rate limiting and `tokenVersion` for
 * bulk revocation. What it had no answer for is the question a user actually
 * asks: "where am I logged in, and can I kill that one?"
 *
 * `tokenVersion` is a sledgehammer — bumping it logs the user out of every
 * device including the one they are holding. That is right for a compromised
 * password and wrong for "I left myself logged in on the ward computer".
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN ITSELF IS NEVER STORED
 * ---------------------------------------------------------------------------
 * Only a SHA-256 of the refresh token. A database dump must not hand the reader
 * a working session for every logged-in clinician — and unlike a password, a
 * session token needs no slow hash, because it is already high-entropy random.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** SHA-256 of the refresh token. Never the token. */
    tokenHash: { type: String, required: true, unique: true, index: true },

    /** What the user recognises in a session list. */
    userAgent: { type: String, trim: true, default: '' },
    deviceLabel: { type: String, trim: true, default: '' },
    ipAddress: { type: String, trim: true, default: '' },

    createdAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, index: true },

    revokedAt: { type: Date, default: null, index: true },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revokeReason: { type: String, trim: true, default: '' },

    /** Whether MFA was satisfied for this session, not just for the account. */
    mfaSatisfied: { type: Boolean, default: false },
  },
  {
    collection: 'sessions',
    toJSON: {
      transform(_doc, ret) {
        // Belt and braces: the hash is not secret in the way a token is, but it
        // has no business on the wire either.
        delete ret.tokenHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/** The user's own session list, most recent first. */
sessionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 });
/** Expired rows are swept by Mongo rather than by a job someone must remember. */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Hash a refresh token for storage or lookup. */
sessionSchema.statics.hashToken = function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
};

/** Live: not revoked, not expired. */
sessionSchema.methods.isActive = function isActive(now = new Date()) {
  return !this.revokedAt && new Date(this.expiresAt) > now;
};

export const Session = mongoose.model('Session', sessionSchema);
export default Session;
