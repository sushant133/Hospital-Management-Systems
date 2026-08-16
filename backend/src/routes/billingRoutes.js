import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listLineItemsQuery,
  createLineItemSchema,
  cancelLineItemSchema,
  outstandingQuery,
} from '../validators/billingValidator.js';
import * as controller from '../controllers/billingController.js';

/**
 * The shared charge ledger, and the reports over it.
 *
 * Invoices and payments have their own router (`invoiceRoutes.js`) because they
 * are gated on different permissions — a receptionist may take a payment
 * without being able to cancel a charge.
 */
const router = Router();

router.use(requireAuth);

const BILLING = MODULES.BILLING;

router.get(
  '/reports/outstanding',
  requirePermission(MODULES.INVOICES, 'view'),
  validate({ query: outstandingQuery }),
  controller.getOutstanding,
);

router.get(
  '/line-items',
  requirePermission(BILLING, 'view'),
  validate({ query: listLineItemsQuery }),
  controller.listLineItems,
);

/** Manual charges for procedures and consumables no feed raises. */
router.post(
  '/line-items',
  requirePermission(BILLING, 'create'),
  validate({ body: createLineItemSchema }),
  audit({ action: 'create', resourceType: 'BillingLineItem' }),
  controller.createLineItem,
);

router.post(
  '/line-items/:id/cancel',
  requirePermission(BILLING, 'cancel'),
  validate({ params: idParam, body: cancelLineItemSchema }),
  audit({ action: 'cancel', resourceType: 'BillingLineItem' }),
  controller.cancelLineItem,
);

export default router;
