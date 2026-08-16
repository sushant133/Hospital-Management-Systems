import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { objectId, listQuery } from '../utils/commonSchemas.js';
import { listAuditLogsQuery } from '../validators/auditLogValidator.js';
import * as controller from '../controllers/auditLogController.js';

const router = Router();

router.use(requireAuth);

/**
 * Read-only by design. There is no POST, PATCH or DELETE here and there never
 * should be: entries are written by middleware/auditLogger.js on the write path, and
 * the model rejects updates and deletes outright.
 */
router.get(
  '/',
  requirePermission(MODULES.AUDIT_LOGS, 'view'),
  validate({ query: listAuditLogsQuery }),
  controller.listAuditLogs,
);

router.get(
  '/patient/:patientId',
  requirePermission(MODULES.AUDIT_LOGS, 'view'),
  validate({ params: z.object({ patientId: objectId }), query: listQuery }),
  controller.listPatientAuditTrail,
);

export default router;
