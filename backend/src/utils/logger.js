import config from '../config/env.js';

/**
 * ============================================================================
 * STRUCTURED LOGGING
 * ============================================================================
 *
 * The previous story was `morgan` to stdout and `console.error`. When a ward
 * reports "the system is slow at 9am OPD peak" there is nothing to look at:
 * lines are unparseable, unattributed, and carry no request id even though the
 * app already generates one.
 *
 * ---------------------------------------------------------------------------
 * JSON IN PRODUCTION, READABLE IN DEVELOPMENT
 * ---------------------------------------------------------------------------
 * A log aggregator wants one JSON object per line. A developer wants to read
 * it. Both are served rather than compromising on a format that suits neither.
 *
 * ---------------------------------------------------------------------------
 * REDACTION IS NOT OPTIONAL HERE
 * ---------------------------------------------------------------------------
 * This is a hospital system. A log line carrying a patient name, a password or
 * a token is a disclosure that outlives the incident it was written for, gets
 * shipped to a third-party aggregator, and is read by people with no clinical
 * relationship to the patient. So redaction happens on the way in, by key name,
 * and errs towards dropping too much.
 */

const LEVELS = { error: 50, warn: 40, info: 30, debug: 20 };

const configuredLevel = LEVELS[process.env.LOG_LEVEL] ?? (config.isProduction ? LEVELS.info : LEVELS.debug);

/**
 * Keys whose values never reach a log, whatever the context.
 * Matched case-insensitively on the key, not the value — a value-based filter
 * would need to recognise a password, which is not possible.
 */
const REDACTED_KEYS = [
  'password', 'passwordhash', 'newpassword', 'currentpassword',
  'token', 'accesstoken', 'refreshtoken', 'authorization', 'cookie',
  'secret', 'apikey', 'privatekey', 'signature',
  'otp', 'pin',
  // Patient-identifying fields. A request body is logged on error, and these
  // are the ones that turn a stack trace into a disclosure.
  'firstname', 'lastname', 'firstnamene', 'lastnamene', 'fullname',
  'phone', 'email', 'address', 'nationalid', 'citizenship', 'mrn',
  'dateofbirth', 'dob',
];

const REDACTED = '[redacted]';

/** Deep-clone with sensitive keys removed. Bounded so a cycle cannot hang. */
export function redact(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

function emit(level, message, context = {}) {
  if (LEVELS[level] < configuredLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact(context),
  };

  const line = config.isProduction
    ? JSON.stringify(entry)
    : `${entry.ts} ${level.toUpperCase().padEnd(5)} ${message}` +
      (Object.keys(context).length ? ` ${JSON.stringify(redact(context))}` : '');

  // stderr for problems, stdout for everything else — so a container runtime
  // can route them differently without parsing.
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  error: (message, context) => emit('error', message, context),
  warn: (message, context) => emit('warn', message, context),
  info: (message, context) => emit('info', message, context),
  debug: (message, context) => emit('debug', message, context),

  /**
   * A logger bound to one request, so every line it writes carries the request
   * id the app already generates. This is the thing that was missing: without
   * it, correlating a slow query to the request that caused it is guesswork.
   */
  forRequest(req) {
    const base = {
      requestId: req.id ?? req.requestId,
      userId: req.user?._id ? String(req.user._id) : undefined,
      role: req.user?.role,
      method: req.method,
      path: req.originalUrl?.split('?')[0],
    };
    return {
      error: (message, context) => emit('error', message, { ...base, ...context }),
      warn: (message, context) => emit('warn', message, { ...base, ...context }),
      info: (message, context) => emit('info', message, { ...base, ...context }),
      debug: (message, context) => emit('debug', message, { ...base, ...context }),
    };
  },
};

/* ==========================================================================
 * METRICS
 * ==========================================================================
 * Deliberately in-process counters rather than a Prometheus client dependency.
 * A small hospital deployment runs one container and needs "is anything slow or
 * failing" answerable from a browser; anyone running a real observability stack
 * can scrape `/metrics` and ignore this.
 */

const metrics = {
  startedAt: Date.now(),
  requests: { total: 0, byStatus: {}, byRoute: {} },
  slowRequests: [],
  errors: { total: 0, byCode: {} },
};

/** Requests slower than this are kept for inspection. */
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 1000);

export function recordRequest({ route, status, durationMs, requestId }) {
  metrics.requests.total += 1;
  metrics.requests.byStatus[status] = (metrics.requests.byStatus[status] ?? 0) + 1;

  const bucket = (metrics.requests.byRoute[route] ??= { count: 0, totalMs: 0, maxMs: 0 });
  bucket.count += 1;
  bucket.totalMs += durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);

  if (durationMs >= SLOW_MS) {
    // Bounded: a sustained slowdown must not turn into unbounded memory use.
    metrics.slowRequests.unshift({ route, status, durationMs, requestId, at: new Date().toISOString() });
    metrics.slowRequests.length = Math.min(metrics.slowRequests.length, 50);
  }
}

export function recordError(code) {
  metrics.errors.total += 1;
  metrics.errors.byCode[code ?? 'UNKNOWN'] = (metrics.errors.byCode[code ?? 'UNKNOWN'] ?? 0) + 1;
}

/** A snapshot, with per-route averages computed at read time. */
export function snapshotMetrics() {
  const routes = Object.entries(metrics.requests.byRoute)
    .map(([route, b]) => ({
      route,
      count: b.count,
      avgMs: Math.round(b.totalMs / b.count),
      maxMs: Math.round(b.maxMs),
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 25);

  return {
    uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000),
    requests: { total: metrics.requests.total, byStatus: metrics.requests.byStatus },
    slowestRoutes: routes,
    recentSlowRequests: metrics.slowRequests.slice(0, 20),
    errors: metrics.errors,
    slowThresholdMs: SLOW_MS,
  };
}

export default logger;
