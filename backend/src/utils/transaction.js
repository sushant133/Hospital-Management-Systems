import mongoose from 'mongoose';
import config from '../config/env.js';

/**
 * ============================================================================
 * MULTI-DOCUMENT TRANSACTIONS
 * ============================================================================
 *
 * Every money and stock path in this system writes several documents that must
 * all land or none: a payment plus the invoice it settles, a dispense plus the
 * batch it depletes plus the charge it raises, an admission plus the bed it
 * occupies. Until now none of them was atomic — a crash or a validation error
 * midway left the ledger internally inconsistent, and nothing detected it.
 *
 * ---------------------------------------------------------------------------
 * TRANSACTIONS NEED A REPLICA SET
 * ---------------------------------------------------------------------------
 * MongoDB only offers sessions and transactions on a replica set. A single
 * `mongod` started without `--replSet` will refuse them, so this is a
 * deployment requirement as much as a code one — see docker-compose.yml, which
 * runs a single-node replica set precisely so the guarantee is available in
 * development and in a small hospital deployment alike.
 *
 * ---------------------------------------------------------------------------
 * WHAT HAPPENS WHEN THEY ARE NOT AVAILABLE
 * ---------------------------------------------------------------------------
 * This is the important design decision. Three options existed:
 *
 *   1. Silently run without a transaction. Rejected: the code would *look*
 *      atomic at every call site while offering no guarantee, which is worse
 *      than never having claimed it.
 *   2. Refuse to start. Rejected: it would strand every existing deployment on
 *      a standalone mongod, including read-only use where it does not matter.
 *   3. Degrade, but loudly and only where explicitly permitted. Chosen.
 *
 * So a caller states its own tolerance. `withTransaction` (the default) throws
 * if sessions are unavailable — used wherever money or stock moves.
 * `withOptionalTransaction` degrades with a warning, for paths where a partial
 * write is recoverable and refusing service would be worse.
 */

/** Cached after the first probe; the topology does not change under us. */
let transactionSupport = null;

/**
 * Does this deployment support transactions?
 *
 * Probed by opening and immediately aborting a real transaction rather than by
 * reading the topology description — a mongos, a single-node replica set and a
 * full replica set all report differently, and the only question that matters
 * is whether `startTransaction` works.
 */
export async function supportsTransactions({ force = false } = {}) {
  if (transactionSupport !== null && !force) return transactionSupport;

  if (mongoose.connection.readyState !== 1) return false;

  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    await session.abortTransaction();
    transactionSupport = true;
  } catch (error) {
    transactionSupport = false;
    console.warn(
      '[tx] This MongoDB deployment does not support transactions ' +
        `(${error.message}). Multi-document writes cannot be made atomic.\n` +
        '     Run mongod with --replSet (a single-node replica set is enough).',
    );
  } finally {
    await session?.endSession();
  }

  return transactionSupport;
}

/** Reset the probe — used by tests that swap connections. */
export function resetTransactionSupport() {
  transactionSupport = null;
}

export class TransactionUnavailableError extends Error {
  constructor(label) {
    super(
      `"${label}" writes several documents that must all succeed or all fail, but this ` +
        'MongoDB deployment does not support transactions. Run mongod with --replSet ' +
        '(a single-node replica set is sufficient) before using this operation.',
    );
    this.name = 'TransactionUnavailableError';
    this.code = 'TRANSACTION_UNAVAILABLE';
    this.statusCode = 503;
  }
}

/**
 * Run `work` inside a transaction, retrying transient failures.
 *
 * `work` receives the session and MUST pass it to every read and write it
 * performs — Mongoose does not thread it implicitly:
 *
 *     await withTransaction('record payment', async (session) => {
 *       const invoice = await Invoice.findById(id).session(session);
 *       await Payment.create([doc], { session });
 *       await invoice.save({ session });
 *     });
 *
 * Note `Model.create([doc], { session })` — the ARRAY form. `create(doc, {
 * session })` silently ignores the session on some Mongoose versions, which is
 * the classic way a write escapes the transaction it appears to be inside.
 *
 * @throws {TransactionUnavailableError} when the deployment cannot do this.
 */
export async function withTransaction(label, work, { retries = 3 } = {}) {
  if (!(await supportsTransactions())) throw new TransactionUnavailableError(label);

  const session = await mongoose.startSession();
  try {
    let attempt = 0;
    // Mongo raises TransientTransactionError on a write conflict; the documented
    // response is to retry the whole transaction, not the failed statement.
    for (;;) {
      attempt += 1;
      try {
        let result;
        await session.withTransaction(async () => {
          result = await work(session);
        });
        return result;
      } catch (error) {
        const transient =
          error?.errorLabels?.includes('TransientTransactionError') ||
          error?.errorLabels?.includes('UnknownTransactionCommitResult');
        if (!transient || attempt >= retries) throw error;
        // Brief backoff with jitter so two colliding writers do not resynchronise.
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 25));
      }
    }
  } finally {
    await session.endSession();
  }
}

/**
 * Run `work` in a transaction when possible, and plainly without one when not.
 *
 * For paths where a partial write is recoverable and refusing service would be
 * worse than a small inconsistency — writing an audit row, queueing a
 * notification. NOT for money or stock: use `withTransaction` there, so the
 * absence of a guarantee is an error rather than a silent downgrade.
 *
 * `work` still receives a session argument, which is `null` in the degraded
 * case; passing `null` to `.session()` is a no-op, so call sites need no branch.
 */
export async function withOptionalTransaction(label, work) {
  if (await supportsTransactions()) return withTransaction(label, work);

  if (!config.isProduction) {
    console.warn(`[tx] "${label}" is running without a transaction — writes are not atomic.`);
  }
  return work(null);
}

/**
 * Report support at startup so an operator learns about it on boot rather than
 * from a failed payment at the counter.
 */
export async function reportTransactionSupport() {
  const supported = await supportsTransactions({ force: true });
  if (supported) {
    console.log('[tx] transactions available — multi-document writes are atomic');
  } else {
    console.warn(
      '[tx] TRANSACTIONS UNAVAILABLE. Payments, dispensing and admissions will be ' +
        'refused rather than written non-atomically. Start mongod with --replSet.',
    );
  }
  return supported;
}

export default { withTransaction, withOptionalTransaction, supportsTransactions };
