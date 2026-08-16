import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * ============================================================================
 * IDEMPOTENCY
 * ============================================================================
 *
 * Now that transactions make retries safe to encourage, retries have to be made
 * safe to *receive*. A cashier whose network drops mid-payment presses the
 * button again; a payment gateway redelivers a webhook for days. Without this,
 * both take the money twice.
 *
 * ---------------------------------------------------------------------------
 * THE RECORD IS CLAIMED BEFORE THE WORK, NOT AFTER
 * ---------------------------------------------------------------------------
 * The obvious design — do the work, then store the key — has a window: two
 * concurrent requests both find no key, both proceed, both charge. So the key
 * is inserted FIRST, and the unique index is what arbitrates. The loser gets a
 * duplicate-key error and waits for the winner's response instead of doing the
 * work again.
 *
 * That means a crashed request can leave a claimed key with no response. Those
 * expire (see `expiresAt`), and `status` distinguishes "in flight" from
 * "finished" so a client retrying into an in-flight request is told to wait
 * rather than being handed a half-truth.
 */
const idempotencyKeySchema = new Schema(
  {
    /** Supplied by the client in the `Idempotency-Key` header. */
    key: { type: String, required: true, trim: true },

    /**
     * Scoped to the route AND the user. The same key from a different endpoint
     * is a different operation, and scoping to the user stops one client's key
     * colliding with another's.
     */
    scope: { type: String, required: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Hash of the request body.
     *
     * A client reusing a key with a DIFFERENT body is a bug on their side, and
     * returning the first response would hide it. Better to refuse loudly: the
     * alternative is a cashier who edits the amount, resubmits, sees "success",
     * and never learns the second amount was ignored.
     */
    requestHash: { type: String, required: true },

    status: { type: String, enum: ['in-flight', 'completed', 'failed'], default: 'in-flight', index: true },

    /** The response to replay, once the first attempt finished. */
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },

    completedAt: { type: Date, default: null },

    /**
     * Keys are not kept forever — 24 hours is far longer than any legitimate
     * retry window, and a TTL index sweeps them without a job.
     */
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 3600 * 1000),
    },
  },
  {
    timestamps: true,
    collection: 'idempotencyKeys',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

/** The arbitration index — this is what makes the whole mechanism work. */
idempotencyKeySchema.index({ key: 1, scope: 1, userId: 1 }, { unique: true });
/** Mongo removes expired keys itself; no job to forget to run. */
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
export default IdempotencyKey;
