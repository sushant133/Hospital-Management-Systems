import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import idempotent from '../middleware/idempotency.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listInvoicesQuery,
  invoicePreviewQuery,
  createInvoiceSchema,
  issueInvoiceSchema,
  cancelInvoiceSchema,
  requestDiscountSchema,
  discountDecisionSchema,
  recordPaymentSchema,
  recordRefundSchema,
} from '../validators/billingValidator.js';
import * as controller from '../controllers/billingController.js';

const router = Router();

router.use(requireAuth);

const INVOICES = MODULES.INVOICES;
const PAYMENTS = MODULES.PAYMENTS;

/** Literal paths before '/:id', or '/preview' would be read as an id. */
router.get(
  '/preview',
  requirePermission(INVOICES, 'view'),
  validate({ query: invoicePreviewQuery }),
  controller.previewInvoice,
);

router.get(
  '/',
  requirePermission(INVOICES, 'view'),
  validate({ query: listInvoicesQuery }),
  controller.listInvoices,
);

router.post(
  '/',
  requirePermission(INVOICES, 'create'),
  validate({ body: createInvoiceSchema }),
  audit({ action: 'create', resourceType: 'Invoice' }),
  controller.createInvoice,
);

router.get(
  '/:id',
  requirePermission(INVOICES, 'view'),
  validate({ params: idParam }),
  controller.getInvoice,
);

/** Generated on demand — the receipt is a rendering, not a stored document. */
router.get(
  '/:id/receipt',
  requirePermission(INVOICES, 'view'),
  validate({ params: idParam }),
  controller.downloadReceipt,
);

router.post(
  '/:id/issue',
  requirePermission(INVOICES, 'edit'),
  validate({ params: idParam, body: issueInvoiceSchema }),
  audit({ action: 'update', resourceType: 'Invoice' }),
  controller.issueInvoice,
);

/** Pull in charges raised after the invoice was drawn up. */
router.post(
  '/:id/charges',
  requirePermission(INVOICES, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Invoice' }),
  controller.syncCharges,
);

/**
 * Abandon a DRAFT invoice.
 *
 * There is deliberately no route to reverse an issued invoice. It carries a
 * number from an unbroken fiscal-year sequence and has been handed to a
 * patient; the only lawful reversal is POST /credit-notes.
 */
router.post(
  '/:id/cancel',
  requirePermission(INVOICES, 'cancel'),
  validate({ params: idParam, body: cancelInvoiceSchema }),
  audit({ action: 'cancel', resourceType: 'Invoice' }),
  controller.cancelDraftInvoice,
);

router.delete(
  '/:id',
  requirePermission(INVOICES, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Invoice' }),
  controller.deleteInvoice,
);

/**
 * Discount: asking and authorising are separate permissions, so the person who
 * requests a discount is never the person who grants it. `approveDiscount` is
 * held by no role explicitly — it is admin-only under the matrix's
 * implicit-admin rule.
 */
router.post(
  '/:id/discount',
  requirePermission(INVOICES, 'applyDiscount'),
  validate({ params: idParam, body: requestDiscountSchema }),
  audit({ action: 'update', resourceType: 'Invoice' }),
  controller.requestDiscount,
);

router.post(
  '/:id/discount/decision',
  requirePermission(INVOICES, 'approveDiscount'),
  validate({ params: idParam, body: discountDecisionSchema }),
  audit({ action: 'approve', resourceType: 'Invoice' }),
  controller.decideDiscount,
);

// --- Money ---
router.post(
  '/:id/payments',
  idempotent('record-payment'),
  requirePermission(PAYMENTS, 'create'),
  validate({ params: idParam, body: recordPaymentSchema }),
  audit({ action: 'create', resourceType: 'Payment' }),
  controller.recordPayment,
);

/** Refunds and credit notes — a narrower grant than taking money in. */
router.post(
  '/:id/refunds',
  idempotent('record-refund'),
  requirePermission(PAYMENTS, 'refund'),
  validate({ params: idParam, body: recordRefundSchema }),
  audit({ action: 'create', resourceType: 'Payment' }),
  controller.recordRefund,
);

export default router;
