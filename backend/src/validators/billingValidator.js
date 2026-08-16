import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  nonEmptyString,
  extendListQuery,
} from '../utils/commonSchemas.js';
import {
  CHARGE_SOURCE_TYPES,
  LINE_ITEM_STATUSES,
} from '../models/BillingLineItem.js';
import { INVOICE_STATUSES, PAYMENT_TYPES, PAYMENT_METHODS } from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

/** Money must be a positive amount with at most two decimal places. */
const money = z.coerce
  .number()
  .min(0.01, 'Enter an amount greater than zero')
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'Amounts are limited to two decimal places',
  });

// ------------------------------------------------------------- the ledger ----

export const listLineItemsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  invoiceId: optionalObjectId,
  sourceType: z.enum(CHARGE_SOURCE_TYPES).optional(),
  status: z.enum(LINE_ITEM_STATUSES).optional(),
});

export const createLineItemSchema = z.object({
  encounterId: objectId,
  description: nonEmptyString(240, 'Description'),
  itemCode: optionalString(40),
  quantity: z.coerce.number().min(0.01).default(1),
  unitPrice: z.coerce.number().min(0),
  /** Manual charges are usually procedures or consumables. */
  sourceType: z.enum(CHARGE_SOURCE_TYPES).optional().default('procedure'),
  sourceRef: optionalString(60),
  departmentId: optionalObjectId,
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  taxCode: optionalString(20),
});

export const cancelLineItemSchema = z.object({
  reason: optionalString(500),
});

// --------------------------------------------------------------- invoices ----

export const listInvoicesQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  status: z.enum(INVOICE_STATUSES).optional(),
  unpaidOnly: booleanFlag,
});

export const invoicePreviewQuery = z.object({
  encounterId: objectId,
});

export const createInvoiceSchema = z.object({
  encounterId: objectId,
  taxPercent: z.coerce.number().min(0).max(100).optional().default(0),
  dueDate: optionalDate,
  notes: optionalString(1000),
  // Totals are derived, never supplied.
});

export const issueInvoiceSchema = z.object({
  dueDate: optionalDate,
});

/**
 * Abandoning a draft. Replaces the former `voidInvoiceSchema` — an issued
 * invoice is reversed by a credit note, never cancelled (see nepalValidator's
 * `createCreditNoteSchema`).
 */
export const cancelInvoiceSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500),
});

// --------------------------------------------------------------- discount ----

export const requestDiscountSchema = z.object({
  amount: money,
  /**
   * Required. A discount is money the hospital chooses not to collect, and the
   * approver needs to know what they are authorising.
   */
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500),
});

export const discountDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject'], {
    errorMap: () => ({ message: 'Approve or reject the request' }),
  }),
  notes: optionalString(500),
});

// --------------------------------------------------------------- payments ----

export const listPaymentsQuery = extendListQuery({
  invoiceId: optionalObjectId,
  patientId: optionalObjectId,
  type: z.enum(PAYMENT_TYPES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});

export const recordPaymentSchema = z.object({
  amount: money,
  method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: 'Choose how the money was received' }),
  }),
  reference: optionalString(80),
  receivedAt: optionalDate,
  notes: optionalString(500),
});

export const recordRefundSchema = z.object({
  /** Positive here; the controller stores it negative. */
  amount: money,
  type: z.enum(['refund', 'credit-note']).default('refund'),
  /** The payment being reversed, where the refund is against a specific one. */
  reversalOf: optionalObjectId,
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: optionalString(80),
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500),
});

export const outstandingQuery = z.object({
  patientId: optionalObjectId,
});
