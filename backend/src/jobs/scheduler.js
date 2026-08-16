import config from '../config/env.js';
import { runBedChargeJob } from './bedChargeJob.js';
import { runExpiryAlertJob } from './expiryAlertJob.js';
import { runLowStockAlertJob } from './lowStockAlertJob.js';
import { computeDailySnapshot } from '../services/warehouseService.js';
import { startCriticalEscalationSweep } from './criticalEscalationJob.js';

/**
 * Run every nightly job once. Safe to call from cron *or* the in-process
 * scheduler — each job is idempotent.
 */
export async function runAllJobs({ now = new Date(), logger = console } = {}) {
  const started = Date.now();
  const results = {};

  try {
    results.bedCharges = await runBedChargeJob({ upTo: now, logger });
  } catch (error) {
    logger.error('[jobs] bedChargeJob failed:', error.message);
    results.bedCharges = { error: error.message };
  }

  try {
    results.expiry = await runExpiryAlertJob({ now, logger });
  } catch (error) {
    logger.error('[jobs] expiryAlertJob failed:', error.message);
    results.expiry = { error: error.message };
  }

  try {
    results.lowStock = await runLowStockAlertJob({ now, logger });
  } catch (error) {
    logger.error('[jobs] lowStockAlertJob failed:', error.message);
    results.lowStock = { error: error.message };
  }

  try {
    results.warehouse = await computeDailySnapshot(now);
  } catch (error) {
    logger.error('[jobs] warehouse snapshot failed:', error.message);
    results.warehouse = { error: error.message };
  }

  logger.log(`[jobs] nightly pass finished in ${Date.now() - started}ms`);
  return results;
}

/** Milliseconds until the next occurrence of `hour`:00 local time. */
export function msUntilHour(hour, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * In-process runner. Fires at `config.jobs.hour` local time every day.
 *
 * This is the default for a single-node deploy. For more than one API replica,
 * disable it (`JOBS_ENABLED=false`) and invoke `scripts/run-jobs.js` from a
 * single cron / sidecar instead — otherwise every replica would charge the
 * same night (the job is idempotent, but you do not want four of them).
 */
export function startJobScheduler({ logger = console } = {}) {
  /**
   * The critical-result sweep starts FIRST and independently of the nightly
   * pass, because it must run whether or not the nightly jobs are enabled.
   * Its window is fifteen minutes; a nightly cadence would be useless.
   */
  const stopSweep = startCriticalEscalationSweep({ logger });

  if (!config.jobs.enabled) {
    logger.log('[jobs] nightly scheduler disabled (JOBS_ENABLED=false); critical sweep still running');
    return { stop: stopSweep };
  }

  let timer = null;
  const hour = Number.isFinite(config.jobs.hour) ? config.jobs.hour : 2;

  const arm = () => {
    const wait = msUntilHour(hour);
    logger.log(`[jobs] next nightly pass in ${Math.round(wait / 60000)} minute(s) (hour=${hour})`);
    timer = setTimeout(async () => {
      try {
        await runAllJobs({ logger });
      } catch (error) {
        logger.error('[jobs] nightly pass crashed:', error);
      } finally {
        arm();
      }
    }, wait);
    timer.unref?.();
  };

  arm();

  return {
    stop() {
      if (timer) clearTimeout(timer);
      stopSweep();
    },
  };
}

export default startJobScheduler;
