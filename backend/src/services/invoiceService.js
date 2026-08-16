import { BillingLineItem, Invoice, Payment, Claim } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Invoice arithmetic.
 *
 * Every money figure on an invoice is DERIVED — from the charge ledger, from
 * the payments against it, and from what an insurer has agreed. Nothing is
 * typed in, and `recomputeTotals` is the single place the sums live, so the
 * invoice can always be rebuilt from its sources rather than trusted.
 */

const round = (value) => Math.round(value * 100) / 100;

/**
 * Charges on an encounter that can go onto an invoice.
 *
 * Unbilled and not cancelled: a line already carrying an `invoiceId` belongs to
 * another bill and must never be pulled onto a second one.
 */
export async function invoiceableCharges(encounterId) {
  return BillingLineItem.find({
    encounterId,
    isActive: true,
    status: 'unbilled',
    invoiceId: null,
  })
    .sort({ chargedAt: 1 })
    .lean();
}

/**
 * Recompute every total on an invoice from its sources and save it.
 *
 *   subtotal              sum of the ledger lines carrying this invoiceId
 *   − approved discount   (a *requested* discount does not reduce anything)
 *   + tax                 taxPercent applied after the discount
 *   = total
 *   − insurer share       what a claim has actually had approved
 *   = patientResponsible
 *   − amountPaid          net of payments, refunds and credit notes
 *   = balance
 */
export async function recomputeTotals(invoice, { save = true, session = null } = {}) {
  // Every read and the final save must carry the caller's session, or they
  // execute outside the transaction they appear to be inside — reading a
  // pre-transaction snapshot and writing outside the atomic unit.
  const [lines, payments] = await Promise.all([
    BillingLineItem.find({ invoiceId: invoice._id, isActive: true, status: { $ne: 'cancelled' } })
      .select('lineTotal taxAmount taxPercent')
      .session(session)
      .lean(),
    Payment.find({ invoiceId: invoice._id, isActive: true }).select('amount').session(session).lean(),
  ]);

  invoice.subtotal = round(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0));

  // Only an approved discount reduces the bill.
  const discount = invoice.discountStatus === 'approved' ? invoice.discountAmount ?? 0 : 0;
  const discounted = Math.max(0, round(invoice.subtotal - discount));

  const lineTax = round(lines.reduce((sum, line) => sum + (line.taxAmount ?? 0), 0));
  invoice.taxAmount =
    lineTax > 0 ? lineTax : round((discounted * (invoice.taxPercent ?? 0)) / 100);
  invoice.total = round(discounted + invoice.taxAmount);

  const insurerShare = Math.min(invoice.insuranceCoveredAmount ?? 0, invoice.total);
  invoice.insuranceCoveredAmount = round(insurerShare);
  invoice.patientResponsibleAmount = round(invoice.total - insurerShare);

  invoice.amountPaid = round(payments.reduce((sum, payment) => sum + payment.amount, 0));
  invoice.balance = round(invoice.patientResponsibleAmount - invoice.amountPaid);

  // Status follows the money, so the two can never disagree.
  // A cancelled draft and a credited invoice are terminal: their status must
  // not be recomputed from the money, or a credited bill would flip back to
  // 'issued' the moment totals are refreshed.
  if (!['cancelled', 'credited', 'draft'].includes(invoice.status)) {
    if (invoice.balance <= 0 && invoice.patientResponsibleAmount > 0) {
      invoice.status = 'paid';
      invoice.paidAt = invoice.paidAt ?? new Date();
    } else if (invoice.amountPaid > 0) {
      invoice.status = 'partially-paid';
      invoice.paidAt = null;
    } else {
      invoice.status = 'issued';
      invoice.paidAt = null;
    }
  }

  if (save) await invoice.save({ session });
  return invoice;
}

/**
 * Pull every unbilled charge on an encounter onto an invoice.
 *
 * The lines are flipped to `invoiced` with an `invoiceId` back-reference in one
 * guarded update — the filter repeats the "still unbilled" condition, so two
 * clerks invoicing the same encounter at once cannot both claim the same lines.
 */
export async function attachCharges({ invoice, encounterId, user }) {
  const charges = await invoiceableCharges(encounterId);
  if (charges.length === 0) return { attached: 0, subtotal: 0 };

  const ids = charges.map((line) => line._id);

  const result = await BillingLineItem.updateMany(
    { _id: { $in: ids }, status: 'unbilled', invoiceId: null },
    { $set: { status: 'invoiced', invoiceId: invoice._id, updatedBy: user?._id ?? null } },
  );

  return {
    attached: result.modifiedCount ?? 0,
    subtotal: round(charges.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)),
  };
}

/** Release an invoice's lines back to the ledger — used when cancelling a draft. */
export async function detachCharges({ invoice, user }) {
  const result = await BillingLineItem.updateMany(
    { invoiceId: invoice._id, status: 'invoiced' },
    { $set: { status: 'unbilled', invoiceId: null, updatedBy: user?._id ?? null } },
  );
  return { released: result.modifiedCount ?? 0 };
}

/**
 * What insurers have agreed against this encounter.
 *
 * Reads from Phase 11 claims: an approved or settled claim reduces what the
 * patient owes. Claims still under review do not — the hospital cannot treat a
 * hoped-for approval as money.
 */
export async function insurerShareForEncounter(encounterId) {
  const claims = await Claim.find({
    encounterId,
    isActive: true,
    status: { $in: ['approved', 'partially-approved', 'settled'] },
  })
    .select('approvedAmount')
    .lean();

  return round(claims.reduce((sum, claim) => sum + (claim.approvedAmount ?? 0), 0));
}

/** Refuse a payment that would take the invoice past what is owed. */
export function assertPaymentAllowed({ invoice, amount }) {
  if (invoice.status === 'cancelled') {
    throw ApiError.conflict('This draft was cancelled', { code: 'INVOICE_CANCELLED' });
  }
  if (invoice.status === 'credited') {
    throw ApiError.conflict('This invoice has been fully credited', { code: 'INVOICE_CREDITED' });
  }
  if (invoice.status === 'draft') {
    throw ApiError.conflict('Issue the invoice before taking payment', { code: 'INVOICE_NOT_ISSUED' });
  }
  if (amount > invoice.balance) {
    throw ApiError.badRequest(
      `That is more than the outstanding balance of ${invoice.balance}.`,
      { code: 'OVERPAYMENT', details: { balance: invoice.balance, offered: amount } },
    );
  }
}

/**
 * Refuse a refund larger than what was actually taken.
 *
 * Checked against the original payment's own net position — a payment already
 * partly refunded cannot be refunded twice for the full amount.
 */
export async function assertRefundAllowed({ invoice, original, amount, session = null }) {
  if (invoice.status === 'cancelled') {
    throw ApiError.conflict('This draft was cancelled', { code: 'INVOICE_CANCELLED' });
  }

  if (original) {
    const priorReversals = await Payment.find({
      reversalOf: original._id,
      isActive: true,
    })
      .select('amount')
      .session(session)
      .lean();

    const alreadyReturned = Math.abs(
      priorReversals.reduce((sum, row) => sum + row.amount, 0),
    );
    const refundable = round(original.amount - alreadyReturned);

    if (amount > refundable) {
      throw ApiError.badRequest(
        `Only ${refundable} of that payment can still be refunded.`,
        { code: 'REFUND_EXCEEDS_PAYMENT', details: { refundable, requested: amount } },
      );
    }
  } else if (amount > invoice.amountPaid) {
    // A standalone credit note cannot return more than has been received.
    throw ApiError.badRequest(
      `Only ${invoice.amountPaid} has been received against this invoice.`,
      { code: 'REFUND_EXCEEDS_RECEIPTS', details: { received: invoice.amountPaid } },
    );
  }
}

/**
 * Outstanding patient balances, bucketed by age.
 *
 * The patient-side counterpart of the insurance aging report: this is money
 * owed by people, that one is money owed by insurers.
 */
export const AGING_BUCKETS = [
  { key: '0-30', min: 0, max: 30 },
  { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 },
  { key: '90+', min: 91, max: Infinity },
];

export async function outstandingReport({ patientId = null, asOf = new Date() } = {}) {
  const filter = {
    isActive: true,
    status: { $in: ['issued', 'partially-paid'] },
    balance: { $gt: 0 },
  };
  if (patientId) filter.patientId = patientId;

  const invoices = await Invoice.find(filter)
    .populate({ path: 'patientId', select: 'mrn firstName lastName phone' })
    .lean();

  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { count: 0, amount: 0 }]));
  let overdueCount = 0;
  let overdueAmount = 0;

  const rows = invoices.map((invoice) => {
    const age = invoice.issuedAt
      ? Math.floor((asOf - new Date(invoice.issuedAt)) / 86400000)
      : 0;
    const bucket = AGING_BUCKETS.find((b) => age >= b.min && age <= b.max) ?? AGING_BUCKETS[3];

    buckets[bucket.key].count += 1;
    buckets[bucket.key].amount = round(buckets[bucket.key].amount + invoice.balance);

    const overdue = invoice.dueDate ? new Date(invoice.dueDate) < asOf : false;
    if (overdue) {
      overdueCount += 1;
      overdueAmount = round(overdueAmount + invoice.balance);
    }

    return {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      patient: invoice.patientId,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balance: invoice.balance,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      ageDays: age,
      bucket: bucket.key,
      overdue,
      status: invoice.status,
    };
  });

  return {
    invoices: rows.sort((a, b) => b.ageDays - a.ageDays),
    buckets,
    totals: {
      count: rows.length,
      outstanding: round(rows.reduce((sum, row) => sum + row.balance, 0)),
      overdueCount,
      overdueAmount,
    },
  };
}

export default {
  invoiceableCharges,
  recomputeTotals,
  attachCharges,
  detachCharges,
  insurerShareForEncounter,
  assertPaymentAllowed,
  assertRefundAllowed,
  outstandingReport,
};
