import { escalateOverdue } from '../services/criticalResultService.js';

/**
 * ============================================================================
 * CRITICAL RESULT ESCALATION SWEEP
 * ============================================================================
 *
 * Moves unacknowledged critical alerts up the ladder when their window expires.
 *
 * ---------------------------------------------------------------------------
 * THIS ONE CANNOT RUN NIGHTLY
 * ---------------------------------------------------------------------------
 * Every other job in this directory fires once a day at 2am, and for bed
 * charges or expiry alerts that is fine. It is useless here: the first
 * escalation window is fifteen minutes, and a potassium of 7.2 discovered at
 * the nightly pass has already killed the patient.
 *
 * So this runs on its own short interval, independent of the nightly scheduler.
 * The sweep is deliberately cheap — one indexed query against
 * `{ status, escalateAfter }` — so a two-minute cadence costs nothing even on a
 * busy hospital.
 */

/** How often the sweep runs. Well under the shortest escalation window. */
export const SWEEP_INTERVAL_MS = 2 * 60 * 1000;

export async function runCriticalEscalationJob({ now = new Date(), logger = console } = {}) {
  const result = await escalateOverdue({ now });

  if (result.escalated > 0 || result.terminal > 0) {
    logger.warn(
      `[jobs] critical alerts: ${result.escalated} escalated, ` +
        `${result.terminal} now sitting with the duty officer`,
    );
  }
  return result;
}

/**
 * Start the sweep.
 *
 * Returns a stop function so tests and a graceful shutdown can cancel it.
 * `unref()` keeps the timer from holding the process open — a hospital server
 * being shut down should not wait two minutes for this.
 */
export function startCriticalEscalationSweep({ logger = console, intervalMs = SWEEP_INTERVAL_MS } = {}) {
  const timer = setInterval(() => {
    runCriticalEscalationJob({ logger }).catch((error) => {
      // Never let a sweep failure kill the interval: the next one must still
      // run, or unacknowledged criticals silently stop escalating forever.
      logger.error('[jobs] critical escalation sweep failed:', error.message);
    });
  }, intervalMs);

  timer.unref?.();
  logger.log(`[jobs] critical result escalation sweeping every ${Math.round(intervalMs / 1000)}s`);

  return () => clearInterval(timer);
}

export default runCriticalEscalationJob;
