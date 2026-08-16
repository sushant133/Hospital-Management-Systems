import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  withTransaction,
  withOptionalTransaction,
  supportsTransactions,
  resetTransactionSupport,
  TransactionUnavailableError,
} from '../../src/utils/transaction.js';

/**
 * D1 — the transaction helper.
 *
 * These run without a database connection, which is the interesting case: they
 * pin the REFUSAL behaviour. The whole design rests on `withTransaction`
 * throwing rather than silently running non-atomically, because code that looks
 * atomic while offering no guarantee is worse than code that never claimed it.
 */

test('transactions: unavailable is detected rather than assumed', async () => {
  resetTransactionSupport();
  // No connection is open, so support must be false — not a thrown error, and
  // certainly not an optimistic true.
  assert.equal(await supportsTransactions({ force: true }), false);
});

test('transactions: a money path REFUSES when transactions are unavailable', async () => {
  resetTransactionSupport();

  let ranAnyway = false;
  await assert.rejects(
    () =>
      withTransaction('record payment', async () => {
        ranAnyway = true;
        return 'should never happen';
      }),
    (error) => {
      assert.ok(error instanceof TransactionUnavailableError);
      assert.equal(error.code, 'TRANSACTION_UNAVAILABLE');
      // 503, not 500: the deployment is misconfigured, not the request.
      assert.equal(error.statusCode, 503);
      return true;
    },
  );

  assert.equal(ranAnyway, false, 'the work must not run outside a transaction');
});

test('transactions: the refusal names the fix', async () => {
  resetTransactionSupport();
  // An operator reading this at 2am needs the answer, not a diagnosis.
  await assert.rejects(
    () => withTransaction('dispense', async () => null),
    /--replSet/,
  );
  await assert.rejects(() => withTransaction('dispense', async () => null), /dispense/);
});

test('transactions: the optional variant degrades instead of refusing', async () => {
  resetTransactionSupport();

  // For paths where a partial write is recoverable and refusing service would
  // be worse — never for money.
  const result = await withOptionalTransaction('queue a notification', async (session) => {
    // The session is null in the degraded case; `.session(null)` is a no-op, so
    // call sites need no branch.
    assert.equal(session, null);
    return 'ran';
  });

  assert.equal(result, 'ran');
});

/* ==========================================================================
 * IDEMPOTENCY — the hashing and scoping rules, which need no database
 * ======================================================================= */

const hashBody = (body) =>
  crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

test('idempotency: the same body hashes the same, a changed amount does not', () => {
  // This is what catches a cashier who corrects an amount and resubmits with
  // the same key — replaying the first response would hide the correction.
  const first = hashBody({ amount: 500, method: 'cash' });
  const same = hashBody({ amount: 500, method: 'cash' });
  const corrected = hashBody({ amount: 5000, method: 'cash' });

  assert.equal(first, same);
  assert.notEqual(first, corrected);
});

test('idempotency: an absent body hashes consistently', () => {
  // A GET-shaped retry must not blow up on an undefined body.
  assert.equal(hashBody(undefined), hashBody(null));
  assert.equal(hashBody(undefined), hashBody({}));
});

test('idempotency: the key model scopes by key, route and user', async () => {
  const { IdempotencyKey } = await import('../../src/models/index.js');
  const indexes = IdempotencyKey.schema.indexes();

  const unique = indexes.find(([, options]) => options?.unique);
  assert.ok(unique, 'the arbitration index must exist — it is what makes this work');
  assert.deepEqual(Object.keys(unique[0]), ['key', 'scope', 'userId']);

  // Keys must expire on their own; a job that has to be remembered will not be.
  const ttl = indexes.find(([, options]) => options?.expireAfterSeconds !== undefined);
  assert.ok(ttl, 'expired keys must be swept by a TTL index');
});

test('idempotency: a key starts in-flight, not completed', async () => {
  const { IdempotencyKey } = await import('../../src/models/index.js');

  // The key is claimed BEFORE the work runs, so two concurrent requests cannot
  // both proceed. A key defaulting to `completed` would let a retry replay an
  // empty response as though the payment had succeeded.
  const claimed = new IdempotencyKey({ key: 'k', scope: 'record-payment', requestHash: 'h' });

  assert.equal(claimed.status, 'in-flight');
  assert.equal(claimed.responseBody, null);
  assert.equal(claimed.completedAt, null);
  // And it carries its own expiry, so a crashed request cannot block the key
  // forever.
  assert.ok(claimed.expiresAt instanceof Date);
  assert.ok(claimed.expiresAt > new Date());
});
