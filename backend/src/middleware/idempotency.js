import crypto from 'node:crypto';
import { IdempotencyKey } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * ============================================================================
 * IDEMPOTENCY MIDDLEWARE
 * ============================================================================
 *
 * Put on any endpoint where doing the work twice costs money: taking a payment,
 * dispensing stock, raising a refund.
 *
 *     router.post('/payments', idempotent('record-payment'), controller.record)
 *
 * The client sends `Idempotency-Key: <uuid>`. A retry with the same key returns
 * the first response instead of repeating the work.
 *
 * ---------------------------------------------------------------------------
 * OPTIONAL BY DEFAULT, AND WHY
 * ---------------------------------------------------------------------------
 * A request with no key is processed normally. Requiring the header would break
 * every existing client the moment this shipped, and a hard failure at the
 * payment counter is worse than the race it prevents. `{ required: true }`
 * tightens it per route once clients are known to send one.
 */

const hashBody = (body) =>
  crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

export function idempotent(scope, { required = false } = {}) {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get('Idempotency-Key');

    if (!key) {
      if (required) {
        return next(
          new ApiError(400, 'This operation requires an Idempotency-Key header.', 'IDEMPOTENCY_KEY_REQUIRED'),
        );
      }
      return next();
    }

    const requestHash = hashBody(req.body);
    const filter = { key, scope, userId: req.user?._id ?? null };

    try {
      // Claim the key BEFORE doing the work. The unique index arbitrates
      // between two concurrent requests; the loser throws E11000 below.
      await IdempotencyKey.create({ ...filter, requestHash });
    } catch (error) {
      if (error?.code !== 11000) return next(error);

      const existing = await IdempotencyKey.findOne(filter).lean();
      if (!existing) return next(); // swept between the insert and the read

      // Same key, different body. Almost always a client bug, and replaying the
      // first response would hide it — a cashier who corrects an amount and
      // resubmits must not be told "success" for the original figure.
      if (existing.requestHash !== requestHash) {
        return next(
          new ApiError(
            409,
            'This Idempotency-Key was already used with a different request body.',
            'IDEMPOTENCY_KEY_REUSED',
          ),
        );
      }

      if (existing.status === 'in-flight') {
        // The first attempt has not finished. Returning a made-up success would
        // be a lie; 409 tells the client to wait and ask again.
        return next(
          new ApiError(
            409,
            'An identical request is still being processed. Retry in a moment.',
            'IDEMPOTENCY_IN_FLIGHT',
          ),
        );
      }

      if (existing.status === 'completed') {
        return res
          .status(existing.responseStatus ?? 200)
          .set('Idempotent-Replay', 'true')
          .json(existing.responseBody);
      }

      // The first attempt failed. Let this one genuinely try again.
      await IdempotencyKey.deleteOne({ _id: existing._id });
      await IdempotencyKey.create({ ...filter, requestHash });
      return next();
    }

    /**
     * Capture the response so a later retry can replay it.
     *
     * Wrapping `res.json` rather than using an `on('finish')` hook because the
     * body itself has to be stored, and by `finish` it is already gone.
     */
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const succeeded = res.statusCode < 400;
      IdempotencyKey.updateOne(filter, {
        $set: {
          status: succeeded ? 'completed' : 'failed',
          responseStatus: res.statusCode,
          responseBody: succeeded ? body : null,
          completedAt: new Date(),
        },
      }).catch((error) => {
        // Never turn a successful payment into an error because bookkeeping
        // failed. The worst case is that a retry redoes the work, which is the
        // situation we were in before this middleware existed.
        console.error('[idempotency] could not record response:', error.message);
      });
      return originalJson(body);
    };

    return next();
  };
}

export default idempotent;
