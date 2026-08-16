import {
  BillingLineItem,
  Invoice,
  Payment,
  Encounter,
  Claim,
  INVOICE_TRANSITIONS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';
import { createCharges } from '../services/billingService.js';
import {
  invoiceableCharges,
  recomputeTotals,
  attachCharges,
  detachCharges,
  insurerShareForEncounter,
  assertPaymentAllowed,
  assertRefundAllowed,
  outstandingReport,
} from '../services/invoiceService.js';
import { generateReceipt } from '../services/pdfService.js';
import { withTransaction } from '../utils/transaction.js';

const INVOICE_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName phone dateOfBirth gender' },
  { path: 'encounterId', select: 'encounterNumber type startedAt endedAt' },
  { path: 'issuedBy', select: 'firstName lastName' },
  { path: 'discountApprovedBy', select: 'firstName lastName' },
];

const PAYMENT_POPULATE = [
  { path: 'receivedBy', select: 'firstName lastName role' },
  { path: 'invoiceId', select: 'invoiceNumber status' },
];

function assertTransition(from, to) {
  const allowed = INVOICE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `Cannot move an invoice from "${from}" to "${to}".` +
        (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This invoice is final.'),
      { code: 'INVALID_STATUS_TRANSITION' },
    );
  }
}

// ------------------------------------------------------------ the ledger ----

/** GET /billing/line-items — the shared charge ledger. */
export const listLineItems = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-chargedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.sourceType ? { sourceType: query.sourceType } : null,
    query.status ? { status: query.status } : null,
    query.invoiceId ? { invoiceId: query.invoiceId } : null,
  );

  const [items, total] = await Promise.all([
    BillingLineItem.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    BillingLineItem.countDocuments(filter),
  ]);

  const totals = items.reduce(
    (acc, item) => {
      acc[item.status] = round((acc[item.status] ?? 0) + item.lineTotal);
      acc.all = round(acc.all + item.lineTotal);
      return acc;
    },
    { all: 0 },
  );

  return sendResponse(res, { data: items, meta: { ...buildMeta({ page, limit, total }), totals } });
});

const round = (value) => Math.round(value * 100) / 100;

/**
 * POST /billing/line-items — a manual charge.
 *
 * For procedures and consumables that no automatic feed raises. Goes through
 * `billingService` like every other module, so there is still exactly one way a
 * charge reaches the ledger.
 */
export const createLineItem = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('That visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }

  const [line] = await createCharges({
    patientId: encounter.patientId,
    encounterId: encounter._id,
    sourceType: req.body.sourceType ?? 'procedure',
    sourceRef: req.body.sourceRef ?? 'manual',
    items: [
      {
        itemCode: req.body.itemCode,
        description: req.body.description,
        quantity: req.body.quantity,
        unitPrice: req.body.unitPrice,
        departmentId: req.body.departmentId,
        taxPercent: req.body.taxPercent,
        taxCode: req.body.taxCode,
      },
    ],
    user: req.user,
  });

  return sendCreated(res, { message: 'Charge added to the ledger', data: line });
});

/** POST /billing/line-items/:id/cancel — reverse a charge that has not been billed. */
export const cancelLineItem = asyncHandler(async (req, res) => {
  const line = await BillingLineItem.findById(req.params.id);
  if (!line) throw ApiError.notFound('Charge not found');

  if (line.status === 'invoiced') {
    throw ApiError.conflict(
      'This charge is on an invoice. Money that has been billed is reversed by a credit note, never by deleting the charge.',
      { code: 'CHARGE_ALREADY_INVOICED', details: { invoiceId: line.invoiceId } },
    );
  }
  if (line.status === 'cancelled') {
    throw ApiError.conflict('This charge is already cancelled', { code: 'ALREADY_CANCELLED' });
  }

  line.status = 'cancelled';
  line.notes = req.body.reason ?? line.notes;
  line.updatedBy = req.user._id;
  await line.save();

  return sendResponse(res, { message: 'Charge cancelled', data: line });
});

// --------------------------------------------------------------- invoices ----

/** GET /invoices */
export const listInvoices = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.status ? { status: query.status } : null,
    query.unpaidOnly ? { status: { $in: ['issued', 'partially-paid'] }, balance: { $gt: 0 } } : null,
  );

  const [invoices, total] = await Promise.all([
    Invoice.find(filter).populate(INVOICE_POPULATE).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Invoice.countDocuments(filter),
  ]);

  return sendResponse(res, { data: invoices, meta: buildMeta({ page, limit, total }) });
});

/** GET /invoices/:id — with its lines and payments. */
export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate(INVOICE_POPULATE).lean({ virtuals: true });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const [lines, payments] = await Promise.all([
    BillingLineItem.find({ invoiceId: invoice._id, isActive: true }).sort({ chargedAt: 1 }).lean(),
    Payment.find({ invoiceId: invoice._id, isActive: true }).populate(PAYMENT_POPULATE).sort({ receivedAt: 1 }).lean(),
  ]);

  return sendResponse(res, { data: { ...invoice, lines, payments } });
});

/**
 * GET /invoices/preview?encounterId= — what an invoice would consolidate.
 * Nothing is written, so the desk can quote a total before committing.
 */
export const previewInvoice = asyncHandler(async (req, res) => {
  const { encounterId } = getQuery(req);

  const charges = await invoiceableCharges(encounterId);
  const subtotal = round(charges.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0));
  const insurerShare = await insurerShareForEncounter(encounterId);

  return sendResponse(res, {
    data: { lines: charges, subtotal },
    meta: {
      lineCount: charges.length,
      insuranceCoveredAmount: insurerShare,
      patientResponsibleAmount: Math.max(0, round(subtotal - insurerShare)),
    },
  });
});

/**
 * POST /invoices — consolidate an encounter's unbilled charges.
 *
 * One open invoice per encounter: a second would split the same visit across
 * two bills and make the balance meaningless.
 */
export const createInvoice = asyncHandler(async (req, res) => {
  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('That visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }

  const existing = await Invoice.findOne({
    encounterId: encounter._id,
    isActive: true,
    status: { $nin: ['cancelled'] },
  }).lean();
  if (existing) {
    throw ApiError.conflict(
      `This visit already has invoice ${existing.invoiceNumber}. Add later charges to it rather than raising a second.`,
      { code: 'INVOICE_EXISTS', details: { invoiceId: existing._id, invoiceNumber: existing.invoiceNumber } },
    );
  }

  const charges = await invoiceableCharges(encounter._id);
  if (charges.length === 0) {
    throw ApiError.conflict('There are no unbilled charges on this visit', {
      code: 'NOTHING_TO_INVOICE',
    });
  }

  const invoice = await Invoice.create({
    patientId: encounter.patientId,
    encounterId: encounter._id,
    taxPercent: req.body.taxPercent ?? 0,
    dueDate: req.body.dueDate ?? null,
    notes: req.body.notes ?? '',
    status: 'draft',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await attachCharges({ invoice, encounterId: encounter._id, user: req.user });

  // Whatever an insurer has already agreed reduces what the patient owes.
  invoice.insuranceCoveredAmount = await insurerShareForEncounter(encounter._id);
  await recomputeTotals(invoice);

  // Claims raised before the bill existed now know which invoice they are against.
  await Claim.updateMany(
    { encounterId: encounter._id, isActive: true, invoiceId: null },
    { $set: { invoiceId: invoice._id, updatedBy: req.user._id } },
  );

  await invoice.populate(INVOICE_POPULATE);
  return sendCreated(res, {
    message: `Invoice ${invoice.invoiceNumber} drafted — ${charges.length} charge(s), total ${invoice.total}`,
    data: invoice,
  });
});

/** POST /invoices/:id/issue — the bill goes to the patient. */
export const issueInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  assertTransition(invoice.status, 'issued');

  invoice.status = 'issued';
  invoice.issuedAt = new Date();
  invoice.issuedBy = req.user._id;
  if (req.body.dueDate) invoice.dueDate = req.body.dueDate;
  invoice.updatedBy = req.user._id;
  await recomputeTotals(invoice);

  await invoice.populate(INVOICE_POPULATE);
  return sendResponse(res, {
    message: `Invoice issued — ${invoice.patientResponsibleAmount} due from the patient`,
    data: invoice,
  });
});

/**
 * POST /invoices/:id/charges — pull in charges raised after the invoice was made.
 *
 * A stay generates charges continuously; this is how a late lab result joins
 * the bill without a second invoice.
 */
export const syncCharges = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (['paid', 'cancelled', 'credited'].includes(invoice.status)) {
    throw ApiError.conflict(`A ${invoice.status} invoice cannot take further charges`, {
      code: 'INVOICE_CLOSED',
    });
  }

  const { attached } = await attachCharges({
    invoice,
    encounterId: invoice.encounterId,
    user: req.user,
  });

  invoice.insuranceCoveredAmount = await insurerShareForEncounter(invoice.encounterId);
  invoice.updatedBy = req.user._id;
  await recomputeTotals(invoice);

  await invoice.populate(INVOICE_POPULATE);
  return sendResponse(res, {
    message: attached
      ? `${attached} further charge(s) added — total is now ${invoice.total}`
      : 'No new charges to add',
    data: invoice,
    meta: { attached },
  });
});

/**
 * POST /invoices/:id/cancel — abandon a DRAFT and release its charges.
 *
 * ---------------------------------------------------------------------------
 * THIS REPLACED "VOID", AND THE NARROWING IS THE POINT
 * ---------------------------------------------------------------------------
 * An *issued* invoice can no longer be cancelled by anyone. It carries a number
 * from an unbroken fiscal-year sequence and has been handed to a patient; IRD
 * reads a hole in that sequence as a suppressed sale. The only lawful reversal
 * is a credit note (POST /credit-notes), which is a separate numbered tax
 * document referencing the original.
 *
 * A draft is different: it was never issued, consumed no number, and was never
 * a tax document. Abandoning one is bookkeeping, not a reversal.
 */
export const cancelDraftInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (invoice.status !== 'draft') {
    throw ApiError.conflict(
      `Invoice ${invoice.invoiceNumber} has been issued and cannot be cancelled. ` +
        'Raise a credit note against it instead.',
      { code: 'INVOICE_ALREADY_ISSUED', details: { status: invoice.status } },
    );
  }

  assertTransition(invoice.status, 'cancelled');

  if (invoice.amountPaid > 0) {
    throw ApiError.conflict(
      `${invoice.amountPaid} has been received against this invoice. Refund it first.`,
      { code: 'INVOICE_HAS_PAYMENTS', details: { amountPaid: invoice.amountPaid } },
    );
  }

  const { released } = await detachCharges({ invoice, user: req.user });

  invoice.status = 'cancelled';
  invoice.cancelledAt = new Date();
  invoice.cancelledBy = req.user._id;
  invoice.cancelReason = req.body.reason;
  invoice.updatedBy = req.user._id;
  await invoice.save();

  await invoice.populate(INVOICE_POPULATE);
  return sendResponse(res, {
    message: `Draft cancelled — ${released} charge(s) returned to the ledger`,
    data: invoice,
    meta: { released },
  });
});

// --------------------------------------------------------------- discount ----

/**
 * POST /invoices/:id/discount — request a discount.
 *
 * Requesting does NOT reduce the bill. `applyDiscount` and `approveDiscount`
 * are separate permissions precisely so that the person who asks for a discount
 * is not the person who grants it — the request is recorded and waits.
 */
export const requestDiscount = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (['paid', 'cancelled', 'credited'].includes(invoice.status)) {
    throw ApiError.conflict(`A ${invoice.status} invoice cannot be discounted`, {
      code: 'INVOICE_CLOSED',
    });
  }
  if (invoice.discountStatus === 'pending') {
    throw ApiError.conflict('A discount request on this invoice is already awaiting approval', {
      code: 'DISCOUNT_PENDING',
    });
  }
  if (req.body.amount > invoice.subtotal) {
    throw ApiError.badRequest(
      `A discount of ${req.body.amount} exceeds the subtotal of ${invoice.subtotal}.`,
      { code: 'DISCOUNT_EXCEEDS_SUBTOTAL' },
    );
  }

  invoice.discountStatus = 'pending';
  invoice.discountRequested = req.body.amount;
  invoice.discountReason = req.body.reason;
  invoice.discountRequestedBy = req.user._id;
  invoice.discountRequestedAt = new Date();
  invoice.updatedBy = req.user._id;
  await invoice.save();

  await invoice.populate(INVOICE_POPULATE);
  return sendResponse(res, {
    message: `Discount of ${req.body.amount} requested — awaiting approval`,
    data: invoice,
  });
});

/**
 * POST /invoices/:id/discount/decision — authorise or refuse it.
 *
 * Gated on `invoices.approveDiscount`, which no role holds explicitly: it is
 * admin-only by the matrix's implicit-admin rule.
 */
export const decideDiscount = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (invoice.discountStatus !== 'pending') {
    throw ApiError.conflict('There is no discount request awaiting a decision on this invoice', {
      code: 'NO_PENDING_DISCOUNT',
    });
  }

  const approved = req.body.decision === 'approve';

  if (approved && String(invoice.discountRequestedBy) === String(req.user._id)) {
    // The whole point of two permissions is that two people are involved.
    throw ApiError.conflict(
      'A discount cannot be approved by the person who requested it.',
      { code: 'SELF_APPROVAL' },
    );
  }

  invoice.discountStatus = approved ? 'approved' : 'rejected';
  invoice.discountAmount = approved ? invoice.discountRequested : 0;
  invoice.discountApprovedBy = req.user._id;
  invoice.discountApprovedAt = new Date();
  invoice.discountDecisionNotes = req.body.notes ?? '';
  invoice.updatedBy = req.user._id;
  await recomputeTotals(invoice);

  await invoice.populate(INVOICE_POPULATE);
  return sendResponse(res, {
    message: approved
      ? `Discount of ${invoice.discountAmount} approved — total is now ${invoice.total}`
      : 'Discount request refused',
    data: invoice,
  });
});

// --------------------------------------------------------------- payments ----

/** GET /payments */
export const listPayments = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-receivedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.invoiceId ? { invoiceId: query.invoiceId } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.type ? { type: query.type } : null,
    query.method ? { method: query.method } : null,
  );

  const [payments, total] = await Promise.all([
    Payment.find(filter).populate(PAYMENT_POPULATE).sort({ receivedAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  return sendResponse(res, { data: payments, meta: buildMeta({ page, limit, total }) });
});

/**
 * POST /invoices/:id/payments — take money, in full or in part.
 *
 * ---------------------------------------------------------------------------
 * ATOMIC, AND IT HAS TO BE
 * ---------------------------------------------------------------------------
 * This writes two documents: the payment row, and the invoice whose balance it
 * changes. A crash between them leaves money recorded against a bill that still
 * shows the full amount outstanding — the patient is chased for what they
 * already paid, and nothing in the system detects it.
 *
 * Note `Payment.create([doc], { session })` — the ARRAY form. The singular form
 * silently ignores the session on several Mongoose versions, which is the
 * classic way a write escapes the transaction it appears to be inside.
 */
export const recordPayment = asyncHandler(async (req, res) => {
  const { payment, invoice } = await withTransaction('record payment', async (session) => {
    const inv = await Invoice.findById(req.params.id).session(session);
    if (!inv) throw ApiError.notFound('Invoice not found');

    assertPaymentAllowed({ invoice: inv, amount: req.body.amount });

    const [row] = await Payment.create(
      [
        {
          invoiceId: inv._id,
          patientId: inv.patientId,
          type: 'payment',
          amount: req.body.amount,
          method: req.body.method,
          reference: req.body.reference ?? '',
          receivedBy: req.user._id,
          receivedAt: req.body.receivedAt ?? new Date(),
          notes: req.body.notes ?? '',
          createdBy: req.user._id,
          updatedBy: req.user._id,
        },
      ],
      { session },
    );

    await recomputeTotals(inv, { session });
    return { payment: row, invoice: inv };
  });

  await payment.populate(PAYMENT_POPULATE);
  return sendCreated(res, {
    message:
      invoice.balance > 0
        ? `Received ${payment.amount} — ${invoice.balance} still outstanding`
        : `Received ${payment.amount} — invoice settled in full`,
    data: payment,
    meta: { balance: invoice.balance, invoiceStatus: invoice.status },
  });
});

/**
 * POST /invoices/:id/refunds — refund or credit note.
 *
 * Written as a NEW negative row pointing at what it reverses, never as an edit
 * to the original payment. The record that money was taken must survive the
 * record that it was given back.
 */
export const recordRefund = asyncHandler(async (req, res) => {
  const { refund, invoice } = await withTransaction('record refund', async (session) => {
    const invoice = await Invoice.findById(req.params.id).session(session);
    if (!invoice) throw ApiError.notFound('Invoice not found');

    let original = null;
    if (req.body.reversalOf) {
      original = await Payment.findOne({
        _id: req.body.reversalOf,
        invoiceId: invoice._id,
        type: 'payment',
        isActive: true,
      }).session(session);
      if (!original) {
        throw ApiError.badRequest('That payment does not exist on this invoice', {
          details: [{ field: 'reversalOf', message: 'Unknown payment' }],
        });
      }
    }

    // Reads the prior reversals inside the transaction, so two concurrent
    // refunds cannot each see an unrefunded payment and both succeed.
    await assertRefundAllowed({ invoice, original, amount: req.body.amount, session });

    const [row] = await Payment.create(
      [
        {
          invoiceId: invoice._id,
          patientId: invoice.patientId,
          type: req.body.type,
          // Stored negative — the invoice's amountPaid is the sum of the rows.
          amount: -Math.abs(req.body.amount),
          method: req.body.method ?? original?.method ?? 'cash',
          reference: req.body.reference ?? '',
          reason: req.body.reason,
          reversalOf: original?._id ?? null,
          receivedBy: req.user._id,
          receivedAt: new Date(),
          createdBy: req.user._id,
          updatedBy: req.user._id,
        },
      ],
      { session },
    );

    await recomputeTotals(invoice, { session });
    return { refund: row, invoice };
  });

  await refund.populate(PAYMENT_POPULATE);
  return sendCreated(res, {
    message: `${req.body.type === 'refund' ? 'Refund' : 'Credit note'} of ${Math.abs(refund.amount)} recorded`,
    data: refund,
    meta: { balance: invoice.balance, amountPaid: invoice.amountPaid, invoiceStatus: invoice.status },
  });
});

/**
 * GET /invoices/:id/receipt — the printable document.
 *
 * Generated on demand rather than stored: a receipt is a rendering of the
 * invoice and its payments, and both can still move until the bill is settled.
 */
export const downloadReceipt = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate(INVOICE_POPULATE).lean();
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const [lines, payments] = await Promise.all([
    BillingLineItem.find({ invoiceId: invoice._id, isActive: true }).sort({ chargedAt: 1 }).lean(),
    Payment.find({ invoiceId: invoice._id, isActive: true })
      .populate({ path: 'receivedBy', select: 'firstName lastName' })
      .sort({ receivedAt: 1 })
      .lean(),
  ]);

  const pdf = await generateReceipt({
    invoice,
    patient: invoice.patientId,
    encounter: invoice.encounterId,
    lines,
    payments,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${invoice.invoiceNumber}-receipt.pdf"`,
  );
  res.send(pdf);
});

// -------------------------------------------------------------- reporting ----

/** GET /billing/reports/outstanding — patient balances by age. */
export const getOutstanding = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const report = await outstandingReport({ patientId: query.patientId ?? null });

  return sendResponse(res, {
    data: report.invoices,
    meta: { buckets: report.buckets, totals: report.totals },
  });
});

/** DELETE /invoices/:id — soft delete a draft that should never have existed. */
export const deleteInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (invoice.status !== 'draft') {
    throw ApiError.conflict('Only a draft invoice can be removed. Void an issued one instead.', {
      code: 'INVOICE_NOT_DRAFT',
    });
  }

  await detachCharges({ invoice, user: req.user });
  Object.assign(invoice, softDeletePatch(req.user));
  await invoice.save();

  return sendResponse(res, { message: 'Draft invoice removed', data: { _id: invoice._id } });
});
