import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { ingestOru } from '../controllers/hl7Controller.js';

const router = Router();
router.use(requireAuth);

/**
 * Raw text/plain is accepted by the app-level parser. JSON `{ message }` is
 * also allowed so a browser or curl can post without a custom content type.
 */
router.post(
  '/hl7',
  requirePermission(MODULES.LAB_RESULTS, 'create'),
  (req, res, next) => {
    if (typeof req.body === 'string') return next();
    return validate({ body: z.object({ message: z.string().min(10) }) })(req, res, next);
  },
  audit({ action: 'create', resourceType: 'LabResult' }),
  ingestOru,
);

export default router;
