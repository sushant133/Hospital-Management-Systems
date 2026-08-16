import { Encounter } from '../models/index.js';
import { chargeBedDays } from '../services/admissionService.js';

/**
 * Charge every in-progress admission for the nights it has used so far.
 *
 * Discharge already settles the whole stay, so this job exists for the stays
 * that have *not* ended: without it a three-week admission contributes nothing
 * to the ledger until the day the patient leaves, and the outstanding balance
 * is wrong for three weeks.
 *
 * Safe to run repeatedly. `chargeBedDays` keys each line on
 * `BED-<YYYY-MM-DD>` per encounter, so a night already charged is skipped —
 * running twice in a day, or running after a discharge already settled the
 * stay, changes nothing.
 *
 * Scheduled by `jobs/scheduler.js` at JOBS_HOUR (default 02:00), or one-shot
 * via `npm run jobs`. Idempotent — overlapping runs skip nights already billed.
 */
export async function runBedChargeJob({ upTo = new Date(), user = null, logger = console } = {}) {
  const admitted = await Encounter.find({
    status: 'admitted',
    isActive: true,
    'admission.admittedAt': { $ne: null },
  });

  let encountersCharged = 0;
  let nightsCharged = 0;
  let totalValue = 0;
  const failures = [];

  for (const encounter of admitted) {
    try {
      const result = await chargeBedDays({ encounter, upTo, user });
      if (result.charged > 0) {
        encountersCharged += 1;
        nightsCharged += result.charged;
        totalValue += result.total;

        encounter.admission.bedChargedThrough = upTo;
        await encounter.save();
      }
    } catch (error) {
      // One bad stay must not stop the rest of the ward being billed.
      failures.push({ encounterId: String(encounter._id), message: error.message });
      logger.error(`[bedChargeJob] ${encounter.encounterNumber}: ${error.message}`);
    }
  }

  const summary = {
    admissionsSeen: admitted.length,
    encountersCharged,
    nightsCharged,
    totalValue: Math.round(totalValue * 100) / 100,
    failures,
  };

  logger.log(
    `[bedChargeJob] ${summary.admissionsSeen} admission(s): ` +
      `${summary.nightsCharged} night(s) charged across ${summary.encountersCharged}, ` +
      `value ${summary.totalValue}` +
      (failures.length ? `, ${failures.length} failed` : ''),
  );

  return summary;
}

export default runBedChargeJob;
