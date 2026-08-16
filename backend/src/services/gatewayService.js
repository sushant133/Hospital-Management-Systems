import crypto from 'node:crypto';
import { GatewayTransaction, Invoice, Payment } from '../models/index.js';
import { GATEWAY_PROVIDERS } from '../models/GatewayTransaction.js';
import config from '../config/env.js';
import { roundPaisa } from '../utils/nepal.js';
import ApiError from '../utils/ApiError.js';

/**
 * ============================================================================
 * DOMESTIC PAYMENT GATEWAYS
 * ============================================================================
 *
 * eSewa, Khalti, Fonepay/NepalPay QR and ConnectIPS behind one interface, so
 * the billing code says "collect this invoice" and never learns which wallet
 * the patient chose.
 *
 * ---------------------------------------------------------------------------
 * THE TWO RULES THAT MATTER
 * ---------------------------------------------------------------------------
 * 1. NEVER TRUST THE REDIRECT. A patient returning to the browser with
 *    "success" in the URL proves nothing — it is trivially forged, and it is
 *    also perfectly normal for the redirect to be lost while the payment did
 *    succeed. Money is only recorded after `verify()` calls the provider's own
 *    API and the provider says so. The redirect merely tells us when to look.
 *
 * 2. SETTLE, DON'T ASSUME. A wallet reporting success is not cash in the
 *    hospital's account. `reconcile()` matches transactions against the
 *    provider's settlement file, and the unmatched list is the report the
 *    accounts office actually needs — it is where money goes missing.
 */

/* ==========================================================================
 * ADAPTERS
 * ==========================================================================
 * Each returns a plain object; none of them writes to the database, so the
 * orchestration below owns every state change and there is one place to audit.
 */

const adapters = {
  [GATEWAY_PROVIDERS.ESEWA]: {
    isEnabled: () => config.gateways.esewa.enabled,

    /** eSewa v2 signs the payload with an HMAC the merchant shares. */
    initiate({ transaction, invoice }) {
      const { merchantCode, secret, baseUrl } = config.gateways.esewa;
      const total = transaction.amount.toFixed(2);
      const signedFields = 'total_amount,transaction_uuid,product_code';
      const message = `total_amount=${total},transaction_uuid=${transaction.reference},product_code=${merchantCode}`;
      const signature = crypto.createHmac('sha256', secret).update(message).digest('base64');

      return {
        checkoutUrl: `${baseUrl}/api/epay/main/v2/form`,
        method: 'POST',
        fields: {
          amount: total,
          tax_amount: '0',
          total_amount: total,
          transaction_uuid: transaction.reference,
          product_code: merchantCode,
          product_service_charge: '0',
          product_delivery_charge: '0',
          success_url: `${config.gateways.returnUrl}?ref=${transaction.reference}`,
          failure_url: `${config.gateways.returnUrl}?ref=${transaction.reference}&failed=1`,
          signed_field_names: signedFields,
          signature,
        },
        meta: { invoiceNumber: invoice.invoiceNumber },
      };
    },

    async verify({ transaction }) {
      const { merchantCode, baseUrl } = config.gateways.esewa;
      const url =
        `${baseUrl}/api/epay/transaction/status/?product_code=${merchantCode}` +
        `&total_amount=${transaction.amount.toFixed(2)}&transaction_uuid=${transaction.reference}`;

      const response = await fetch(url);
      const payload = await response.json().catch(() => ({}));

      return {
        settled: payload?.status === 'COMPLETE',
        providerTransactionId: payload?.ref_id || '',
        amount: Number(payload?.total_amount ?? transaction.amount),
        raw: payload,
      };
    },
  },

  [GATEWAY_PROVIDERS.KHALTI]: {
    isEnabled: () => config.gateways.khalti.enabled,

    async initiate({ transaction, invoice, patient }) {
      const { secretKey, baseUrl } = config.gateways.khalti;
      const response = await fetch(`${baseUrl}/epayment/initiate/`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          return_url: `${config.gateways.returnUrl}?ref=${transaction.reference}`,
          website_url: config.clientOrigins[0],
          // Khalti works in paisa, not rupees. Getting this wrong bills the
          // patient a hundred times the amount.
          amount: Math.round(transaction.amount * 100),
          purchase_order_id: transaction.reference,
          purchase_order_name: `Invoice ${invoice.invoiceNumber}`,
          customer_info: {
            name: patient?.fullName || '',
            phone: patient?.phone || '',
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.payment_url) {
        throw new ApiError(502, `Khalti refused the payment request: ${payload?.detail || response.status}`);
      }

      return {
        checkoutUrl: payload.payment_url,
        method: 'GET',
        fields: {},
        providerReference: payload.pidx,
        meta: payload,
      };
    },

    async verify({ transaction }) {
      const { secretKey, baseUrl } = config.gateways.khalti;
      const response = await fetch(`${baseUrl}/epayment/lookup/`, {
        method: 'POST',
        headers: { Authorization: `Key ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pidx: transaction.providerReference }),
      });
      const payload = await response.json().catch(() => ({}));

      return {
        settled: payload?.status === 'Completed',
        providerTransactionId: payload?.transaction_id || '',
        // Back to rupees from paisa.
        amount: roundPaisa((payload?.total_amount ?? 0) / 100),
        raw: payload,
      };
    },
  },

  [GATEWAY_PROVIDERS.FONEPAY]: {
    isEnabled: () => config.gateways.fonepay.enabled,

    /**
     * Counter QR: the patient scans with any NepalPay-enabled bank app. There
     * is no redirect at all, so the QR is displayed and the transaction stays
     * `pending` until either the webhook lands or the cashier polls verify().
     */
    initiate({ transaction }) {
      const { merchantCode, secret } = config.gateways.fonepay;
      const amount = transaction.amount.toFixed(2);
      const message = `${merchantCode},${transaction.reference},${amount}`;
      const signature = crypto.createHmac('sha512', secret).update(message).digest('hex');

      return {
        // The payload a NepalPay QR encodes. Rendered to an image client-side.
        qrPayload: JSON.stringify({
          merchantCode,
          amount,
          prn: transaction.reference,
          remarks: 'Hospital bill',
          signature,
        }),
        method: 'QR',
        fields: {},
      };
    },

    async verify({ transaction }) {
      const { merchantCode, secret, baseUrl } = config.gateways.fonepay;
      const message = `${merchantCode},${transaction.reference}`;
      const signature = crypto.createHmac('sha512', secret).update(message).digest('hex');

      const response = await fetch(`${baseUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantCode, prn: transaction.reference, signature }),
      });
      const payload = await response.json().catch(() => ({}));

      return {
        settled: payload?.paymentStatus === 'success',
        providerTransactionId: payload?.traceId || '',
        amount: Number(payload?.amount ?? transaction.amount),
        raw: payload,
      };
    },
  },
};

/** The providers this hospital has actually configured. */
export function availableProviders() {
  return Object.entries(adapters)
    .filter(([, adapter]) => adapter.isEnabled())
    .map(([provider]) => provider);
}

function adapterFor(provider) {
  const adapter = adapters[provider];
  if (!adapter) throw new ApiError(400, `No adapter for payment provider "${provider}".`);
  if (!adapter.isEnabled()) {
    throw new ApiError(400, `${provider} is not configured in this hospital.`);
  }
  return adapter;
}

/* ==========================================================================
 * ORCHESTRATION
 * ======================================================================= */

/**
 * Open a collection against an invoice.
 *
 * The amount is taken from the invoice's outstanding balance, never from the
 * request: a client that could name its own amount could settle a 50,000 rupee
 * bill for 1 rupee.
 */
export async function initiate({ invoiceId, provider, user, patient, amount = null }) {
  const adapter = adapterFor(provider);

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new ApiError(404, 'Invoice not found.');
  if (invoice.status === 'draft') {
    throw new ApiError(400, 'Issue the invoice before collecting payment against it.');
  }

  const outstanding = roundPaisa(invoice.balance);
  if (outstanding <= 0) throw new ApiError(400, 'This invoice has nothing outstanding.');

  const requested = amount === null ? outstanding : roundPaisa(amount);
  if (requested <= 0 || requested > outstanding) {
    throw new ApiError(400, `Amount must be between 0 and the outstanding balance (${outstanding}).`);
  }

  // Reuse an in-flight attempt rather than opening a second one — a patient
  // double-clicking must not end up with two live collections on one bill.
  const existing = await GatewayTransaction.findOne({
    invoiceId,
    provider,
    status: { $in: ['initiated', 'pending'] },
    expiresAt: { $gt: new Date() },
  });
  if (existing) return { transaction: existing, reused: true };

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const transaction = await GatewayTransaction.create({
    provider,
    invoiceId,
    patientId: invoice.patientId,
    amount: requested,
    status: 'initiated',
    initiatedBy: user?._id ?? null,
    expiresAt,
    createdBy: user?._id ?? null,
  });

  const result = await adapter.initiate({ transaction, invoice, patient });

  transaction.checkoutUrl = result.checkoutUrl || '';
  transaction.qrPayload = result.qrPayload || '';
  transaction.providerReference = result.providerReference || '';
  transaction.status = 'pending';
  transaction.providerEvents.push({ kind: 'initiate', payload: result.meta ?? null });
  await transaction.save();

  return { transaction, instructions: result, reused: false };
}

/**
 * Ask the provider whether the money actually moved, and record it if so.
 *
 * This is the ONLY path that creates a `Payment`. Both the browser redirect and
 * the provider webhook funnel into it, and it is idempotent: a transaction that
 * already carries a `paymentId` returns that payment rather than making another.
 * Gateways retry webhooks, sometimes for days.
 */
export async function verify({ reference, actorId = null }) {
  const transaction = await GatewayTransaction.findOne({ reference });
  if (!transaction) throw new ApiError(404, 'No such payment reference.');

  // Already settled — return what we recorded, do not double-count.
  if (transaction.paymentId) {
    const payment = await Payment.findById(transaction.paymentId);
    return { transaction, payment, alreadySettled: true };
  }

  if (['failed', 'expired', 'refunded'].includes(transaction.status)) {
    return { transaction, payment: null, alreadySettled: false };
  }

  const adapter = adapterFor(transaction.provider);
  const result = await adapter.verify({ transaction });

  transaction.providerEvents.push({ kind: 'verify', payload: result.raw ?? null });

  if (!result.settled) {
    // Not settled is not the same as failed — the patient may still be at the
    // wallet. Only an expired window turns a pending attempt into a failure.
    if (transaction.expiresAt && transaction.expiresAt < new Date()) {
      transaction.status = 'expired';
      transaction.failureReason = 'The payment window closed before the wallet confirmed.';
    }
    await transaction.save();
    return { transaction, payment: null, alreadySettled: false };
  }

  // The provider says it settled — but for how much? A mismatch means we are
  // about to credit a bill with money that did not arrive.
  const paid = roundPaisa(result.amount);
  if (Math.abs(paid - transaction.amount) > 0.01) {
    transaction.status = 'failed';
    transaction.failureReason =
      `Amount mismatch: expected ${transaction.amount}, provider reported ${paid}. ` +
      'Held for manual reconciliation rather than credited.';
    await transaction.save();
    throw new ApiError(409, transaction.failureReason, 'GATEWAY_AMOUNT_MISMATCH');
  }

  const payment = await Payment.create({
    invoiceId: transaction.invoiceId,
    patientId: transaction.patientId,
    amount: paid,
    method: transaction.provider,
    type: 'payment',
    reference: result.providerTransactionId || transaction.reference,
    receivedAt: new Date(),
    createdBy: actorId,
  });

  transaction.status = 'succeeded';
  transaction.providerTransactionId = result.providerTransactionId || '';
  transaction.completedAt = new Date();
  transaction.paymentId = payment._id;
  await transaction.save();

  return { transaction, payment, alreadySettled: false };
}

/**
 * Match succeeded transactions against a provider's settlement file.
 *
 * `rows` is the parsed settlement export: `{ providerTransactionId, amount, fee,
 * settlementReference }`. Anything the file does not mention stays unreconciled
 * and appears on the exceptions list — which is the entire point.
 */
export async function reconcile({ provider, rows, settledOn }) {
  const byProviderId = new Map(rows.map((r) => [String(r.providerTransactionId), r]));

  const candidates = await GatewayTransaction.find({
    provider,
    status: 'succeeded',
    reconciledAt: null,
  });

  const matched = [];
  const discrepancies = [];

  for (const transaction of candidates) {
    const row = byProviderId.get(String(transaction.providerTransactionId));
    if (!row) continue;

    const settled = roundPaisa(row.amount);
    if (Math.abs(settled - transaction.amount) > 0.01) {
      discrepancies.push({
        reference: transaction.reference,
        expected: transaction.amount,
        settled,
        note: 'Settlement amount differs from the recorded payment.',
      });
      continue;
    }

    transaction.reconciledAt = settledOn || new Date();
    transaction.settlementReference = row.settlementReference || '';
    transaction.settledAmount = settled;
    transaction.feeAmount = roundPaisa(row.fee || 0);
    transaction.status = 'reconciled';
    await transaction.save();
    matched.push(transaction.reference);
    byProviderId.delete(String(transaction.providerTransactionId));
  }

  // Money the provider says they sent that we have no record of collecting.
  const unknownToUs = [...byProviderId.values()].map((r) => ({
    providerTransactionId: r.providerTransactionId,
    amount: r.amount,
    note: 'Present in the settlement file but not recorded in the hospital ledger.',
  }));

  // Money we recorded that never settled — the one that actually costs.
  const stillUnsettled = await GatewayTransaction.countDocuments({
    provider,
    status: 'succeeded',
    reconciledAt: null,
  });

  return { matched, discrepancies, unknownToUs, stillUnsettled };
}

export default { initiate, verify, reconcile, availableProviders };
