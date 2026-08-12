import AuditLog from '../models/AuditLog.js';

/**
 * Never write these into the trail, at any depth. The audit log is widely
 * readable by administrators and long-lived; credentials must not accumulate
 * in it.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'tokenVersion',
]);

const REDACTION_PLACEHOLDER = '[redacted]';

/** Values longer than this are truncated — audit rows are metadata, not backups. */
const MAX_VALUE_LENGTH = 2000;

function normalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') {
    // ObjectId, Decimal128 and friends stringify cleanly.
    if (typeof value.toHexString === 'function') return value.toHexString();
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = REDACTED_FIELDS.has(key) ? REDACTION_PLACEHOLDER : normalizeValue(nested);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
    return `${value.slice(0, MAX_VALUE_LENGTH)}…[truncated]`;
  }
  return value;
}

function stableStringify(value) {
  try {
    return JSON.stringify(normalizeValue(value));
  } catch {
    return String(value);
  }
}

/**
 * Field-level diff between two plain objects, keeping only what changed.
 *
 * Nested objects are compared whole rather than recursively: a change inside
 * `address` is recorded as the old and new `address`. That is enough to answer
 * "what did this edit do?" without the diff logic becoming a project of its own.
 */
export function diffDocuments(before, after) {
  const beforeObj = toPlain(before);
  const afterObj = toPlain(after);

  if (!beforeObj && !afterObj) return null;
  if (!beforeObj) return { after: normalizeValue(afterObj) };
  if (!afterObj) return { before: normalizeValue(beforeObj) };

  const changed = {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const key of keys) {
    if (key === '_id' || key === '__v' || key === 'updatedAt' || key === 'createdAt') continue;

    if (REDACTED_FIELDS.has(key)) {
      // Record *that* it changed, never the values.
      if (stableStringify(beforeObj[key]) !== stableStringify(afterObj[key])) {
        changed[key] = { from: REDACTION_PLACEHOLDER, to: REDACTION_PLACEHOLDER };
      }
      continue;
    }

    if (stableStringify(beforeObj[key]) !== stableStringify(afterObj[key])) {
      changed[key] = {
        from: normalizeValue(beforeObj[key]),
        to: normalizeValue(afterObj[key]),
      };
    }
  }

  return Object.keys(changed).length > 0 ? changed : null;
}

function toPlain(value) {
  if (!value) return null;
  if (typeof value.toObject === 'function') return value.toObject({ depopulate: true });
  return value;
}

/**
 * Write one audit entry directly. Use this for events that are not a route's
 * main create/edit/delete — sign-in attempts, for example.
 *
 * Never throws: a failed audit write is logged to stderr but must not turn a
 * successful clinical action into a 500 for the user at the bedside. The
 * trade-off is deliberate and documented in ARCHITECTURE.md §5.
 */
export async function recordAudit(entry) {
  try {
    await AuditLog.create(entry);
  } catch (error) {
    console.error('[audit] failed to write audit entry:', error.message, {
      action: entry?.action,
      module: entry?.module,
      resourceType: entry?.resourceType,
    });
  }
}

/**
 * Controllers call this to enrich the entry the middleware is about to write —
 * most usefully to supply the pre-change document so the diff is real.
 *
 *   const before = patient.toObject();
 *   Object.assign(patient, req.body);
 *   await patient.save();
 *   setAuditContext(req, { before, after: patient, patientId: patient._id });
 */
export function setAuditContext(req, context = {}) {
  req.auditContext = { ...(req.auditContext ?? {}), ...context };
}

/**
 * Route middleware that records the outcome of a write.
 *
 *   router.post(
 *     '/',
 *     requireAuth,
 *     requirePermission(MODULES.PATIENTS, 'create'),
 *     validate({ body: createPatientSchema }),
 *     audit({ action: 'create', resourceType: 'Patient' }),
 *     controller.createPatient,
 *   );
 *
 * Mount it BEFORE the controller — it wraps `res.json` to capture the response
 * body, then writes the entry after the response has been flushed, so the audit
 * round-trip never sits in the user's latency path.
 *
 * Only 2xx responses are recorded as `success`. 4xx/5xx are recorded as
 * `failure` when `logFailures` is on (default for delete and override actions,
 * where a rejected attempt is itself interesting), and skipped otherwise.
 */
export function audit({
  action,
  resourceType,
  module: moduleOverride,
  logFailures = action === 'delete' || action === 'override',
} = {}) {
  if (!action) throw new Error('audit() requires an action.');
  if (!resourceType) throw new Error('audit() requires a resourceType.');

  return function auditMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);
    let responseBody = null;

    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (!succeeded && !logFailures) return;

      const context = req.auditContext ?? {};
      const payload = responseBody?.data ?? null;

      const resourceId =
        context.resourceId ??
        payload?._id ??
        payload?.id ??
        (isObjectIdLike(req.params?.id) ? req.params.id : undefined);

      const changes =
        context.changes ??
        (context.before || context.after
          ? diffDocuments(context.before, context.after ?? payload)
          : buildCreationSnapshot(action, payload));

      void recordAudit({
        userId: req.user?._id,
        userName: req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : undefined,
        userRole: req.user?.role,

        action,
        module: moduleOverride ?? req.permission?.module ?? 'unknown',
        resourceType,
        resourceId,
        resourceRef:
          context.resourceRef ?? payload?.mrn ?? payload?.orderNumber ?? payload?.encounterNumber,

        patientId: context.patientId ?? payload?.patientId ?? undefined,
        encounterId: context.encounterId ?? payload?.encounterId ?? undefined,

        changes,
        reason: context.reason ?? req.body?.reason,

        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        outcome: succeeded ? 'success' : 'failure',
        ipAddress: req.ip,
        userAgent: req.get?.('user-agent'),
      });
    });

    next();
  };
}

/** On create there is no "before", so the whole new document is the change. */
function buildCreationSnapshot(action, payload) {
  if (action !== 'create' || !payload) return null;
  return { after: normalizeValue(toPlain(payload)) };
}

function isObjectIdLike(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

export default audit;
