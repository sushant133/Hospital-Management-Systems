import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  createCreditNoteSchema,
  listCreditNotesQuery,
  initiatePaymentSchema,
  verifyPaymentSchema,
  reconcileSchema,
  listGatewayTxnQuery,
} from '../validators/nepalValidator.js';
import * as creditNotes from '../controllers/creditNoteController.js';
import * as gateway from '../controllers/gatewayController.js';

/* ==========================================================================
 * CREDIT NOTES (A8)
 * ==========================================================================
 * There is deliberately no "void invoice" route anywhere in this codebase.
 * An issued invoice carries a number from an unbroken fiscal-year sequence;
 * every reversal comes through here as a separate, numbered tax document.
 */
export const creditNoteRouter = Router();
creditNoteRouter.use(requireAuth);

creditNoteRouter.get(
  '/',
  requirePermission(MODULES.CREDIT_NOTES, 'view'),
  validate({ query: listCreditNotesQuery }),
  creditNotes.listCreditNotes,
);

/**
 * The sequence-integrity report — the question an IRD inspection opens with.
 * Declared before `/:id` so the literal path is reachable.
 */
creditNoteRouter.get(
  '/sequence-integrity',
  requirePermission(MODULES.CREDIT_NOTES, 'view'),
  creditNotes.sequenceIntegrity,
);

creditNoteRouter.get(
  '/:id',
  requirePermission(MODULES.CREDIT_NOTES, 'view'),
  validate({ params: idParam }),
  creditNotes.getCreditNote,
);
creditNoteRouter.post(
  '/',
  requirePermission(MODULES.CREDIT_NOTES, 'create'),
  validate({ body: createCreditNoteSchema }),
  audit({ action: 'create', resourceType: 'CreditNote' }),
  creditNotes.createCreditNote,
);

/* ==========================================================================
 * GATEWAY PAYMENTS (A10)
 * ======================================================================= */
/**
 * The provider webhook, on its OWN top-level router.
 *
 * It cannot live under `/payments/gateway`: that path is nested inside the
 * `/payments` mount, whose router applies `requireAuth` to everything beneath
 * it. A gateway has no session, so the callback would be rejected with 401 and
 * the hospital would silently stop learning about completed payments — the
 * failure mode being that money arrives and no invoice is ever marked paid.
 *
 * Declaring it separately makes the security boundary explicit rather than
 * dependent on mount ordering across two files.
 *
 * What makes an unauthenticated endpoint safe here is that the handler trusts
 * nothing in the payload beyond a reference: it calls the provider's own API
 * back to ask whether money actually moved. A forged webhook therefore achieves
 * nothing except making us ask a question we already know the answer to.
 */
export const gatewayWebhookRouter = Router();
gatewayWebhookRouter.post('/', gateway.webhook);
gatewayWebhookRouter.get('/', gateway.webhook);

export const gatewayRouter = Router();

gatewayRouter.use(requireAuth);

gatewayRouter.get('/providers', requirePermission(MODULES.GATEWAY_PAYMENTS, 'view'), gateway.listProviders);
gatewayRouter.get(
  '/',
  requirePermission(MODULES.GATEWAY_PAYMENTS, 'view'),
  validate({ query: listGatewayTxnQuery }),
  gateway.listTransactions,
);
gatewayRouter.get(
  '/unsettled',
  requirePermission(MODULES.GATEWAY_PAYMENTS, 'reconcile'),
  gateway.unsettledReport,
);
gatewayRouter.post(
  '/initiate',
  requirePermission(MODULES.GATEWAY_PAYMENTS, 'initiate'),
  validate({ body: initiatePaymentSchema }),
  audit({ action: 'create', resourceType: 'GatewayTransaction' }),
  gateway.initiate,
);
gatewayRouter.post(
  '/verify',
  requirePermission(MODULES.GATEWAY_PAYMENTS, 'verify'),
  validate({ body: verifyPaymentSchema }),
  audit({ action: 'update', resourceType: 'GatewayTransaction' }),
  gateway.verify,
);
gatewayRouter.post(
  '/reconcile',
  requirePermission(MODULES.GATEWAY_PAYMENTS, 'reconcile'),
  validate({ body: reconcileSchema }),
  audit({ action: 'update', resourceType: 'GatewayTransaction' }),
  gateway.reconcile,
);
gatewayRouter.get(
  '/:reference',
  requirePermission(MODULES.GATEWAY_PAYMENTS, 'view'),
  gateway.getTransaction,
);
