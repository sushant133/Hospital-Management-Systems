import { CreditNote, Invoice, BillingLineItem } from '../models/index.js';
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
import { roundPaisa, fiscalYearOf, formatNpr } from '../utils/nepal.js';
import { peekFiscalSequence } from '../utils/sequence.js';
import config from '../config/env.js';

/**
 * ============================================================================
 * CREDIT NOTES — REVERSING AN ISSUED INVOICE
 * ============================================================================
 *
 * There is no "void invoice" endpoint, and that absence is the point. An issued
 * invoice carries a number from an unbroken fiscal-year sequence and has been
 * handed to a patient; IRD reads a hole in that sequence as a suppressed sale.
 * Every reversal comes through here.
 */

export const listCreditNotes = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-issuedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.invoiceId ? { invoiceId: query.invoiceId } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.fiscalYear ? { fiscalYear: query.fiscalYear } : null,
    query.reason ? { reason: query.reason } : null,
    searchFilter(query.search, ['creditNoteNumber', 'invoiceNumber']),
  );

  const [rows, total] = await Promise.all([
    CreditNote.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'issuedBy', select: 'firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    CreditNote.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getCreditNote = asyncHandler(async (req, res) => {
  const note = await CreditNote.findById(req.params.id)
    .populate({ path: 'patientId', select: 'mrn firstName lastName firstNameNe lastNameNe' })
    .populate({ path: 'invoiceId', select: 'invoiceNumber total status issuedAt' })
    .populate({ path: 'issuedBy approvedBy', select: 'firstName lastName' });
  if (!note) throw ApiError.notFound('Credit note not found');
  return sendResponse(res, { data: note });
});

export const createCreditNote = asyncHandler(async (req, res) => {
  const { invoiceId, lines, reason, reasonNote } = req.body;

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  // A draft was never a tax document — it can simply be edited or abandoned.
  // Crediting one would burn a credit-note number for nothing.
  if (invoice.status === 'draft') {
    throw ApiError.badRequest(
      'This invoice has not been issued. Edit or cancel the draft instead of crediting it.',
      { code: 'INVOICE_NOT_ISSUED' },
    );
  }
  if (invoice.status === 'cancelled') {
    throw ApiError.badRequest('A cancelled draft cannot be credited.');
  }

  // Validate every referenced line actually belongs to this invoice. Without
  // this, a credit note could quietly reverse a charge from a different
  // patient's bill.
  const referenced = lines.filter((l) => l.lineItemId).map((l) => l.lineItemId);
  if (referenced.length > 0) {
    const owned = await BillingLineItem.countDocuments({
      _id: { $in: referenced },
      invoiceId: invoice._id,
    });
    if (owned !== referenced.length) {
      throw ApiError.badRequest(
        'One or more credited lines do not belong to this invoice.',
        { code: 'LINE_NOT_ON_INVOICE' },
      );
    }
  }

  const subtotal = roundPaisa(lines.reduce((sum, l) => sum + l.amount, 0));
  const taxAmount = roundPaisa(lines.reduce((sum, l) => sum + (l.taxAmount || 0), 0));
  const total = roundPaisa(subtotal + taxAmount);

  // Cumulative guard: several partial credits must not add up to more than the
  // invoice was ever worth.
  const alreadyCredited = roundPaisa(invoice.creditedAmount || 0);
  if (total + alreadyCredited > roundPaisa(invoice.total) + 0.01) {
    throw ApiError.conflict(
      `Crediting ${formatNpr(total)} would take the total credited past the invoice value ` +
        `(${formatNpr(invoice.total)}, of which ${formatNpr(alreadyCredited)} is already credited).`,
      { code: 'CREDIT_EXCEEDS_INVOICE' },
    );
  }

  const note = await CreditNote.create({
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    patientId: invoice.patientId,
    encounterId: invoice.encounterId,
    lines,
    subtotal,
    taxAmount,
    total,
    reason,
    reasonNote: reasonNote || '',
    issuedBy: req.user._id,
    fiscalYear: fiscalYearOf().code,
    // Only a VAT-registered hospital syncs to CBMS; otherwise there is nothing
    // to send and `pending` rows would accumulate forever in the outbox.
    cbms: {
      status: config.ird.cbmsEnabled && config.ird.vatRegistered ? 'pending' : 'not-applicable',
    },
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  // Update the invoice's credited total and status. The invoice's own frozen
  // fields are untouched — what was handed to the patient still reads the same.
  invoice.creditNoteIds.push(note._id);
  invoice.creditedAmount = roundPaisa(alreadyCredited + total);
  if (invoice.creditedAmount >= roundPaisa(invoice.total) - 0.01) {
    invoice.status = 'credited';
  }
  invoice.updatedBy = req.user._id;
  await invoice.save();

  return sendCreated(res, {
    message: `Credit note ${note.creditNoteNumber} raised against ${invoice.invoiceNumber}`,
    data: note,
  });
});

/**
 * ============================================================================
 * THE SEQUENCE INTEGRITY REPORT
 * ============================================================================
 *
 * The single question an IRD inspection opens with: is the invoice sequence for
 * this fiscal year unbroken?
 *
 * A gap is not automatically wrongdoing — a number is consumed at issue and a
 * crash between allocation and save would leave one — but the hospital must be
 * able to *explain* each one rather than discover it during the inspection.
 */
export const sequenceIntegrity = asyncHandler(async (req, res) => {
  const fiscalYear = getQuery(req).fiscalYear || fiscalYearOf().code;

  const [invoices, creditNotes, invoiceHighWater, creditHighWater] = await Promise.all([
    Invoice.find({ fiscalYear, invoiceNumber: { $ne: null } })
      .select('invoiceNumber issuedAt status total')
      .sort({ invoiceNumber: 1 })
      .lean(),
    CreditNote.find({ fiscalYear }).select('creditNoteNumber issuedAt total').sort({ creditNoteNumber: 1 }).lean(),
    peekFiscalSequence('invoice', fiscalYear),
    peekFiscalSequence('creditNote', fiscalYear),
  ]);

  /** Pull the trailing sequence number out of "INV-2081/82-000123". */
  const sequenceOf = (number) => Number(String(number).split('-').pop());

  const findGaps = (rows, field, highWater) => {
    const seen = new Set(rows.map((r) => sequenceOf(r[field])));
    const gaps = [];
    for (let n = 1; n <= highWater; n += 1) if (!seen.has(n)) gaps.push(n);
    return gaps;
  };

  const invoiceGaps = findGaps(invoices, 'invoiceNumber', invoiceHighWater);
  const creditGaps = findGaps(creditNotes, 'creditNoteNumber', creditHighWater);

  return sendResponse(res, {
    data: {
      fiscalYear,
      invoices: {
        issued: invoices.length,
        highestAllocated: invoiceHighWater,
        gaps: invoiceGaps,
        totalValue: roundPaisa(invoices.reduce((sum, i) => sum + (i.total || 0), 0)),
      },
      creditNotes: {
        issued: creditNotes.length,
        highestAllocated: creditHighWater,
        gaps: creditGaps,
        totalValue: roundPaisa(creditNotes.reduce((sum, n) => sum + (n.total || 0), 0)),
      },
      intact: invoiceGaps.length === 0 && creditGaps.length === 0,
    },
    meta: {
      note:
        invoiceGaps.length > 0 || creditGaps.length > 0
          ? 'A gap means a number was allocated but its document was never saved. ' +
            'Each one needs an explanation you can give an inspector.'
          : 'The sequence is unbroken.',
    },
  });
});
