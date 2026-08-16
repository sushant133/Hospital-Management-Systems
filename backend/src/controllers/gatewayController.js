import { GatewayTransaction, Patient } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
  searchFilter,
} from '../utils/queryHelpers.js';
import {
  initiate as initiateCollection,
  verify as verifyCollection,
  reconcile as reconcileSettlement,
  availableProviders,
} from '../services/gatewayService.js';
import { roundPaisa } from '../utils/nepal.js';

/** Which wallets this hospital has actually configured. */
export const listProviders = asyncHandler(async (_req, res) =>
  sendResponse(res, {
    data: availableProviders(),
    meta: { note: 'Providers appear here only when their credentials are configured.' },
  }),
);

export const listTransactions = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-initiatedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.provider ? { provider: query.provider } : null,
    query.status ? { status: query.status } : null,
    query.invoiceId ? { invoiceId: query.invoiceId } : null,
    // The report that matters: money we recorded as collected that no
    // settlement file has ever confirmed.
    query.unsettledOnly ? { status: 'succeeded', reconciledAt: null } : null,
    searchFilter(query.search, ['reference', 'providerTransactionId', 'providerReference']),
  );

  const [rows, total] = await Promise.all([
    GatewayTransaction.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'invoiceId', select: 'invoiceNumber total balance' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    GatewayTransaction.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

/**
 * Open a collection.
 *
 * Returns whatever the chosen provider needs the client to do next: a redirect
 * URL, a form to POST, or a QR payload to render at the counter.
 */
export const initiate = asyncHandler(async (req, res) => {
  const { invoiceId, provider, amount } = req.body;

  const patient = await Patient.findOne({ _id: req.body.patientId }).lean().catch(() => null);

  const result = await initiateCollection({
    invoiceId,
    provider,
    amount: amount ?? null,
    user: req.user,
    patient,
  });

  if (result.reused) {
    return sendResponse(res, {
      message: 'A payment is already open against this invoice for this provider.',
      data: { transaction: result.transaction },
    });
  }

  return sendCreated(res, {
    message: 'Payment opened',
    data: {
      transaction: result.transaction,
      /** How the client should send the patient to pay. */
      instructions: result.instructions,
    },
  });
});

/**
 * Confirm with the provider that money actually moved.
 *
 * Called by the browser when the patient returns, by the cashier polling a QR,
 * and by the provider's webhook. All three funnel here because the redirect
 * proves nothing — it is trivially forged, and it is equally normal for it to
 * be lost while the payment succeeded.
 */
export const verify = asyncHandler(async (req, res) => {
  const reference = req.body.reference || req.params.reference;
  const result = await verifyCollection({ reference, actorId: req.user?._id ?? null });

  if (result.alreadySettled) {
    return sendResponse(res, {
      message: 'This payment was already recorded.',
      data: { transaction: result.transaction, payment: result.payment },
    });
  }

  if (!result.payment) {
    return sendResponse(res, {
      message:
        result.transaction.status === 'expired'
          ? 'The payment window closed before the wallet confirmed.'
          : 'The provider has not confirmed this payment yet.',
      data: { transaction: result.transaction, payment: null },
    });
  }

  return sendResponse(res, {
    message: 'Payment confirmed and recorded',
    data: { transaction: result.transaction, payment: result.payment },
  });
});

/**
 * Provider webhook.
 *
 * Unauthenticated by necessity — the gateway has no session — so it does
 * nothing but name a reference. The actual settlement decision is made by
 * calling the provider back through `verify`, which means a forged webhook
 * achieves nothing beyond making us ask the provider a question.
 *
 * Always answers 200: a gateway that receives an error will retry for days,
 * and the retry is pointless once we have looked.
 */
export const webhook = asyncHandler(async (req, res) => {
  const reference =
    req.body?.reference ||
    req.body?.purchase_order_id ||
    req.body?.transaction_uuid ||
    req.body?.prn ||
    req.query?.ref;

  if (!reference) {
    return res.status(200).json({ received: true, acted: false, reason: 'no reference in payload' });
  }

  try {
    const result = await verifyCollection({ reference, actorId: null });
    return res.status(200).json({
      received: true,
      acted: Boolean(result.payment) && !result.alreadySettled,
      status: result.transaction.status,
    });
  } catch (error) {
    // Recorded, not thrown: an amount mismatch is held for manual
    // reconciliation, and the gateway does not need to hear about it.
    console.error('[gateway webhook]', reference, error.message);
    return res.status(200).json({ received: true, acted: false, reason: error.message });
  }
});

/**
 * Match a provider's settlement file against what we recorded.
 *
 * This is where money actually goes missing: a wallet reports success, the
 * hospital records a payment, and the funds never land. Nothing else in the
 * system notices.
 */
export const reconcile = asyncHandler(async (req, res) => {
  const { provider, rows, settledOn } = req.body;

  const result = await reconcileSettlement({ provider, rows, settledOn });

  const hasExceptions =
    result.discrepancies.length > 0 || result.unknownToUs.length > 0 || result.stillUnsettled > 0;

  return sendResponse(res, {
    message: hasExceptions
      ? `${result.matched.length} matched, ${result.discrepancies.length + result.unknownToUs.length} exceptions need attention.`
      : `${result.matched.length} transactions reconciled cleanly.`,
    data: result,
  });
});

/** Unsettled collections, oldest first — the accounts office worklist. */
export const unsettledReport = asyncHandler(async (req, res) => {
  const olderThanDays = Number(getQuery(req).olderThanDays ?? 2);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const rows = await GatewayTransaction.find({
    status: 'succeeded',
    reconciledAt: null,
    completedAt: { $lt: cutoff },
    isActive: true,
  })
    .populate({ path: 'invoiceId', select: 'invoiceNumber' })
    .sort({ completedAt: 1 })
    .limit(500)
    .lean();

  const byProvider = rows.reduce((acc, row) => {
    acc[row.provider] = acc[row.provider] || { count: 0, amount: 0 };
    acc[row.provider].count += 1;
    acc[row.provider].amount = roundPaisa(acc[row.provider].amount + row.amount);
    return acc;
  }, {});

  return sendResponse(res, {
    data: rows,
    meta: {
      olderThanDays,
      total: rows.length,
      totalAmount: roundPaisa(rows.reduce((sum, r) => sum + r.amount, 0)),
      byProvider,
      note:
        rows.length > 0
          ? 'These were recorded as collected but no settlement file has confirmed them.'
          : 'Every recorded collection has been settled.',
    },
  });
});

/** One transaction, with its full provider event trail for dispute handling. */
export const getTransaction = asyncHandler(async (req, res) => {
  const transaction = await GatewayTransaction.findOne({ reference: req.params.reference })
    .populate({ path: 'invoiceId', select: 'invoiceNumber total balance' })
    .populate({ path: 'patientId', select: 'mrn firstName lastName' })
    .populate({ path: 'paymentId' });
  if (!transaction) throw ApiError.notFound('No such payment reference');
  return sendResponse(res, { data: transaction });
});
