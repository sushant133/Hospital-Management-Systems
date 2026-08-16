/**
 * One-shot nightly jobs. Use from cron or a sidecar:
 *
 *   node scripts/run-jobs.js
 *
 * Each job is idempotent — overlapping runs will not double-charge a night
 * or re-expire a batch.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { runAllJobs } from '../src/jobs/scheduler.js';

const started = Date.now();

try {
  await connectDatabase();
  const results = await runAllJobs();
  console.log('[jobs] result', JSON.stringify(results, null, 2));
  await disconnectDatabase();
  console.log(`[jobs] done in ${Date.now() - started}ms`);
  process.exit(0);
} catch (error) {
  console.error('[jobs] failed:', error);
  process.exit(1);
}
