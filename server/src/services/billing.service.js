import { BillingLineItem } from '../models/index.js';

/**
 * The ONLY way a module should raise a patient charge.
 *
 * Modules never create invoices. They append to the shared billing ledger; the
 * Phase 8 invoicing job aggregates unbilled rows per encounter into an invoice.
 *
 * @param {object}   params
 * @param {object[]} params.items       [{ itemCode, description, quantity, unitPrice, departmentId }]
 * @param {string}   params.sourceType  'lab' | 'radiology' | 'pharmacy' | ...
 * @param {object}   params.user        req.user — stamped as createdBy
 * @returns {Promise<object[]>} the created line items
 */
export async function createCharges({
  patientId,
  encounterId,
  sourceType,
  sourceId = null,
  sourceRef = '',
  items = [],
  user = null,
  chargedAt = new Date(),
}) {
  if (!items.length) return [];

  const documents = items.map((item) => ({
    patientId,
    encounterId,
    sourceType,
    sourceId,
    sourceRef,
    itemCode: item.itemCode ?? '',
    description: item.description,
    quantity: item.quantity ?? 1,
    unitPrice: item.unitPrice ?? 0,
    departmentId: item.departmentId ?? null,
    status: 'unbilled',
    chargedAt,
    createdBy: user?._id ?? null,
    updatedBy: user?._id ?? null,
  }));

  // create() (not insertMany) so the pre-validate hook computing lineTotal runs.
  return BillingLineItem.create(documents);
}

/**
 * Reverse the charges raised by a source document — used when an order is
 * cancelled. Rows already pulled onto an invoice are left alone: money that has
 * been billed is reversed by a credit note in Phase 8, never by mutating history.
 *
 * @returns {Promise<{ cancelled: number, alreadyInvoiced: number }>}
 */
export async function cancelChargesForSource({ sourceType, sourceId, user = null, reason = '' }) {
  const alreadyInvoiced = await BillingLineItem.countDocuments({
    sourceType,
    sourceId,
    status: 'invoiced',
    isActive: true,
  });

  const result = await BillingLineItem.updateMany(
    { sourceType, sourceId, status: 'unbilled', isActive: true },
    {
      $set: {
        status: 'cancelled',
        updatedBy: user?._id ?? null,
        ...(reason ? { notes: reason } : {}),
      },
    },
  );

  return { cancelled: result.modifiedCount ?? 0, alreadyInvoiced };
}

/** All charges raised against an encounter, newest first. */
export function listChargesForEncounter(encounterId, { status } = {}) {
  return BillingLineItem.find({
    encounterId,
    isActive: true,
    ...(status ? { status } : {}),
  })
    .sort({ chargedAt: -1 })
    .lean();
}

/** Running total of unbilled charges on an encounter. */
export async function unbilledTotalForEncounter(encounterId) {
  const [row] = await BillingLineItem.aggregate([
    { $match: { encounterId, status: 'unbilled', isActive: true } },
    { $group: { _id: null, total: { $sum: '$lineTotal' }, count: { $sum: 1 } } },
  ]);
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

export default createCharges;
