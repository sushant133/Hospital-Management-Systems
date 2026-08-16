import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { listPaymentsQuery } from '../validators/billingValidator.js';
import * as controller from '../controllers/billingController.js';

/**
 * Read-only view of money received.
 *
 * Payments are *recorded* against an invoice (`/invoices/:id/payments`) — this
 * exists so the cash desk can see the day's takings across every invoice.
 */
const router = Router();

router.use(requireAuth);

router.get(
  '/',
  requirePermission(MODULES.PAYMENTS, 'view'),
  validate({ query: listPaymentsQuery }),
  controller.listPayments,
);

export default router;
