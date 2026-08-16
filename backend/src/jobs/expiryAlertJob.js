import { DrugBatch } from '../models/index.js';
import { expiringBatches } from '../services/pharmacyService.js';

/**
 * Sweep the shelf for stock that is expiring, or has already expired.
 *
 * Two jobs in one pass, because they read the same rows:
 *   1. anything already past its expiry date is marked `expired`, which takes
 *      it out of FEFO immediately — dispensing already refuses out-of-date
 *      stock, but leaving it flagged `active` misreports what is on hand;
 *   2. anything expiring within the warning window is reported so the pharmacy
 *      can use it, return it or write it off while it still has value.
 *
 * Idempotent: marking an already-expired batch changes nothing.
 *
 * Scheduled by `jobs/scheduler.js` at JOBS_HOUR, or one-shot via `npm run jobs`.
 */
export async function runExpiryAlertJob({
  warnWithinDays = 90,
  now = new Date(),
  logger = console,
} = {}) {
  // --- 1. Retire what is already out of date ---
  const stale = await DrugBatch.find({
    isActive: true,
    status: 'active',
    expiryDate: { $lte: now },
  }).populate({ path: 'drugId', select: 'name strength' });

  let markedExpired = 0;
  let valueExpired = 0;

  for (const batch of stale) {
    batch.status = 'expired';
    batch.adjustmentNotes = batch.adjustmentNotes || 'Marked expired automatically by expiryAlertJob';
    await batch.save();
    markedExpired += 1;
    valueExpired += batch.quantityOnHand * (batch.costPrice ?? 0);
  }

  // --- 2. Warn about what is close ---
  const expiring = await expiringBatches({ days: warnWithinDays, now });

  const summary = {
    markedExpired,
    valueExpired: Math.round(valueExpired * 100) / 100,
    expiringSoon: expiring.length,
    valueAtRisk:
      Math.round(expiring.reduce((sum, b) => sum + b.quantityOnHand * (b.costPrice ?? 0), 0) * 100) /
      100,
    warnWithinDays,
    batches: expiring.map((batch) => ({
      batchNo: batch.batchNo,
      drug: batch.drugId?.name,
      expiryDate: batch.expiryDate,
      quantityOnHand: batch.quantityOnHand,
    })),
  };

  logger.log(
    `[expiryAlertJob] ${markedExpired} batch(es) marked expired (value ${summary.valueExpired}); ` +
      `${expiring.length} expiring within ${warnWithinDays} days (value at risk ${summary.valueAtRisk})`,
  );

  return summary;
}

export default runExpiryAlertJob;
