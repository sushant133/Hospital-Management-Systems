import { DailySnapshot } from '../models/index.js';
import { computeDailySnapshot } from './warehouseService.js';
import { logger } from '../utils/logger.js';

/**
 * ============================================================================
 * REPORTING AT SCALE (D7)
 * ============================================================================
 *
 * The reports aggregate live over the operational collections. That is fine at
 * demo size and degrades badly at three years of data — at exactly the month-end
 * moment when the whole finance office runs them at once, on the same database
 * the OPD is trying to admit patients through.
 *
 * ---------------------------------------------------------------------------
 * THE FIX IS ARCHITECTURAL, NOT A CACHE
 * ---------------------------------------------------------------------------
 * `DailySnapshot` and `warehouseService` already existed but nothing read from
 * them. The right shape is: yesterday and earlier come from pre-computed
 * snapshots (immutable — a closed day cannot change), and only TODAY is
 * aggregated live. A year-long revenue report then reads 365 small documents
 * instead of scanning every invoice ever written.
 *
 * The short-lived cache below is for the live portion only. It exists because
 * ten people opening the dashboard within a minute should not produce ten
 * identical aggregations, not because the underlying query is acceptable.
 */

/** Live-aggregate results, held briefly. Small and bounded by design. */
const cache = new Map();

const DEFAULT_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 200;

/**
 * Memoise an expensive aggregation for a short window.
 *
 * Deliberately NOT used for anything a user just changed — a cashier who posts
 * a payment and sees a stale total will conclude the payment failed and post it
 * again. Reports only.
 */
export async function cached(key, producer, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await producer();

  // Bounded: a report with a high-cardinality key (per patient, say) must not
  // turn the cache into a memory leak.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }

  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Drop cached reports — called after a write that would make them wrong. */
export function invalidate(prefix = '') {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * A date range served from snapshots for closed days plus a live tail for today.
 *
 * This is the pattern every heavy report should use. `liveProducer` is called
 * only for the part that genuinely cannot be pre-computed.
 */
export async function fromSnapshots({ from, to, liveProducer = null }) {
  const today = startOfDay(new Date());
  const rangeEnd = startOfDay(to);

  const closedEnd = rangeEnd >= today ? new Date(today.getTime() - 1) : to;

  const snapshots = await DailySnapshot.find({
    date: { $gte: startOfDay(from), $lte: closedEnd },
  })
    .sort({ date: 1 })
    .lean();

  let live = null;
  if (rangeEnd >= today && liveProducer) {
    live = await cached(`live:${today.toISOString().slice(0, 10)}`, liveProducer);
  }

  return {
    snapshots,
    live,
    /**
     * Reported so a reader knows what they are looking at. A report that
     * silently omits days with no snapshot looks complete and is not — and the
     * gap is usually the day the snapshot job failed.
     */
    coverage: {
      expectedDays: Math.max(0, Math.round((closedEnd - startOfDay(from)) / 86400000) + 1),
      snapshotDays: snapshots.length,
      includesToday: Boolean(live),
    },
  };
}

/**
 * Backfill missing snapshots.
 *
 * Snapshots are only useful if they exist for every closed day. The nightly job
 * writes one; this repairs the holes left by a night the job did not run, which
 * is otherwise discovered as a suspiciously quiet week in an annual report.
 */
export async function backfillSnapshots({ days = 30, logger: log = logger } = {}) {
  const today = startOfDay(new Date());
  const created = [];

  for (let offset = 1; offset <= days; offset += 1) {
    const date = new Date(today.getTime() - offset * 86400000);
    const existing = await DailySnapshot.findOne({ date }).select('_id').lean();
    if (existing) continue;

    try {
      await computeDailySnapshot(date);
      created.push(date.toISOString().slice(0, 10));
    } catch (error) {
      log.error('snapshot backfill failed', { date: date.toISOString().slice(0, 10), error: error.message });
    }
  }

  if (created.length > 0) log.info('snapshots backfilled', { days: created.length, dates: created });
  return { created };
}

export default { cached, invalidate, fromSnapshots, backfillSnapshots };
