import mongoose from 'mongoose';
import { logger, recordRequest, recordError } from '../utils/logger.js';
import config from '../config/env.js';

/**
 * ============================================================================
 * REQUEST TIMING AND HEALTH (D6)
 * ============================================================================
 */

/**
 * Time every request and record it against a NORMALISED route.
 *
 * `/patients/507f.../encounters` and `/patients/608a.../encounters` are the same
 * route; keeping the raw path would produce one bucket per patient and make the
 * per-route averages useless — as well as putting record identifiers into the
 * metrics, which is its own small disclosure.
 */
export function requestMetrics(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    const route = (req.originalUrl || req.url)
      .split('?')[0]
      .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:n');

    recordRequest({ route, status: res.statusCode, durationMs, requestId: req.id });

    // Only the interesting ones. Logging every 200 at info level drowns the
    // signal in a hospital doing tens of thousands of requests a day.
    if (res.statusCode >= 500 || durationMs >= 1000) {
      logger.forRequest(req).warn('slow or failed request', {
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    }
  });

  next();
}

/** Called by the error handler so failures are counted, not just logged. */
export function countError(error) {
  recordError(error?.code ?? error?.name);
}

/**
 * A health check that actually checks something.
 *
 * The previous endpoint returned `{ status: 'ok' }` unconditionally — it proved
 * the process was running and nothing else. A load balancer using it would have
 * kept routing traffic to a container that had lost its database.
 *
 * Reports transaction support too, because a deployment without it refuses
 * every payment, and that must be visible from outside rather than discovered
 * at the counter.
 */
export async function deepHealth(_req, res) {
  const checks = {};
  let healthy = true;

  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const state = states[mongoose.connection.readyState] ?? 'unknown';
  checks.database = { state };

  if (mongoose.connection.readyState === 1) {
    try {
      const startedAt = Date.now();
      await mongoose.connection.db.admin().ping();
      checks.database.pingMs = Date.now() - startedAt;
      checks.database.name = mongoose.connection.name;
    } catch (error) {
      healthy = false;
      checks.database.error = error.message;
    }
  } else {
    healthy = false;
  }

  try {
    const { supportsTransactions } = await import('../utils/transaction.js');
    const supported = await supportsTransactions();
    checks.transactions = {
      supported,
      // Not fatal for readiness — reads still work — but payments will refuse,
      // so it is surfaced prominently rather than buried.
      note: supported ? undefined : 'Payments and dispensing will be refused. Run mongod with --replSet.',
    };
  } catch {
    checks.transactions = { supported: false };
  }

  const { devanagariAvailable, fontInstallHint } = await import('../services/devanagariFont.js');
  checks.devanagariFont = {
    available: devanagariAvailable,
    note: devanagariAvailable ? undefined : fontInstallHint,
  };

  const memory = process.memoryUsage();
  checks.process = {
    uptimeSeconds: Math.round(process.uptime()),
    heapUsedMb: Math.round(memory.heapUsed / 1048576),
    rssMb: Math.round(memory.rss / 1048576),
    nodeVersion: process.version,
    env: config.env,
  };

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() },
  });
}

export default { requestMetrics, deepHealth, countError };
