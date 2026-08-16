import config from '../config/env.js';
import { recordAudit } from './auditLogger.js';

/**
 * Record a PHI *read* after a successful GET.
 *
 * Off unless `AUDIT_READS=true`. The `view` action has been on the schema
 * since Phase 0 and was left unwired on purpose: a row per chart open would
 * drown the write trail. When a regulator asks for read-access logs, flip the
 * flag — no other code change.
 *
 *   router.get('/:id', requireAuth, requirePermission(...), auditRead({ resourceType: 'Patient' }), controller.get)
 */
export function auditRead({ resourceType, module: moduleOverride } = {}) {
  if (!resourceType) throw new Error('auditRead() requires a resourceType.');

  return function auditReadMiddleware(req, res, next) {
    if (!config.auditReads) return next();

    const originalJson = res.json.bind(res);
    let responseBody = null;
    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const payload = responseBody?.data ?? {};
      const resourceId = payload._id ?? payload.id ?? req.params?.id;
      void recordAudit({
        userId: req.user?._id,
        userName: req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : undefined,
        userRole: req.user?.role,
        action: 'view',
        module: moduleOverride ?? req.permission?.module ?? 'unknown',
        resourceType,
        resourceId,
        resourceRef: payload.mrn ?? payload.orderNumber ?? payload.encounterNumber,
        patientId: payload.patientId ?? (resourceType === 'Patient' ? resourceId : undefined),
        encounterId: payload.encounterId ?? (resourceType === 'Encounter' ? resourceId : undefined),
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        outcome: 'success',
        ipAddress: req.ip,
        userAgent: req.get?.('user-agent'),
        requestId: req.id,
      });
    });

    next();
  };
}

export default auditRead;
