import {
  InventoryItem,
  InventoryTransaction,
  TRANSACTION_DIRECTION,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Stock movements for non-drug inventory.
 *
 * One rule governs this file: **the balance and the ledger must never
 * disagree.** Every movement is applied with a guarded conditional update, and
 * the ledger row is written from the result of that update rather than from
 * what the caller asked for — so a row can never claim a balance the item did
 * not actually reach.
 */

/** The signed movement for a request, given its type. */
export function signedFor({ type, quantity, direction }) {
  if (type === 'adjustment') {
    // A stock count can correct in either direction; the caller says which.
    return direction === 'decrease' ? -Math.abs(quantity) : Math.abs(quantity);
  }
  return TRANSACTION_DIRECTION[type] * Math.abs(quantity);
}

/**
 * Apply one movement and record it.
 *
 * Outward movements use `{ quantityOnHand: { $gte: n } }` as a precondition, so
 * two stores issuing the last box at the same moment cannot both succeed —
 * the second gets a clean conflict instead of a negative balance.
 *
 * @returns {Promise<{ item, transaction }>}
 */
export async function applyTransaction({
  itemId,
  type,
  quantity,
  direction,
  departmentId = null,
  reference = '',
  reason = '',
  occurredAt = new Date(),
  user,
}) {
  const item = await InventoryItem.findOne({ _id: itemId, isActive: true }).lean();
  if (!item) {
    throw ApiError.badRequest('That item is not in the inventory', {
      details: [{ field: 'itemId', message: 'Unknown or retired item' }],
    });
  }

  const signed = signedFor({ type, quantity, direction });

  if (signed === 0) {
    throw ApiError.badRequest('A movement of zero changes nothing');
  }

  // Outward movements must not take more than is there.
  const guard = { _id: item._id, isActive: true };
  if (signed < 0) guard.quantityOnHand = { $gte: Math.abs(signed) };

  const updated = await InventoryItem.findOneAndUpdate(
    guard,
    { $inc: { quantityOnHand: signed }, $set: { updatedBy: user?._id ?? null } },
    { new: true },
  );

  if (!updated) {
    throw ApiError.conflict(
      `Only ${item.quantityOnHand} ${item.unit}(s) of ${item.name} are in stock — cannot ${type} ${Math.abs(signed)}.`,
      {
        code: 'INSUFFICIENT_INVENTORY',
        details: { available: item.quantityOnHand, requested: Math.abs(signed) },
      },
    );
  }

  const unitCost = item.unitCost ?? 0;

  try {
    const transaction = await InventoryTransaction.create({
      itemId: item._id,
      itemName: item.name,
      type,
      quantity: Math.abs(quantity),
      signedQuantity: signed,
      // Read from the updated document, so the ledger cannot claim a balance
      // the item never held.
      balanceAfter: updated.quantityOnHand,
      departmentId,
      reference,
      reason,
      unitCost,
      lineValue: Math.round(Math.abs(signed) * unitCost * 100) / 100,
      performedBy: user?._id ?? null,
      occurredAt,
      createdBy: user?._id ?? null,
      updatedBy: user?._id ?? null,
    });

    return { item: updated, transaction };
  } catch (error) {
    // The balance moved but the ledger row failed — put it back rather than
    // leaving stock that nothing accounts for.
    await InventoryItem.findByIdAndUpdate(item._id, { $inc: { quantityOnHand: -signed } });
    throw error;
  }
}

/**
 * Recompute an item's balance from its ledger.
 *
 * The running balance is what every read uses; this is how you prove it is
 * right, and what a stock-take reconciles against.
 */
export async function reconcile(itemId) {
  const [row] = await InventoryTransaction.aggregate([
    { $match: { itemId: new InventoryItem.base.Types.ObjectId(String(itemId)), isActive: true } },
    { $group: { _id: null, total: { $sum: '$signedQuantity' } } },
  ]);

  const item = await InventoryItem.findById(itemId).select('quantityOnHand name').lean();
  const fromLedger = row?.total ?? 0;

  return {
    itemId,
    name: item?.name,
    balance: item?.quantityOnHand ?? 0,
    fromLedger,
    reconciled: (item?.quantityOnHand ?? 0) === fromLedger,
  };
}

/** Items at or below their reorder level, worst first. */
export async function lowStockItems() {
  const items = await InventoryItem.find({ isActive: true, reorderLevel: { $gt: 0 } })
    .select('itemCode name unit quantityOnHand reorderLevel unitCost location')
    .lean();

  return items
    .filter((item) => item.quantityOnHand <= item.reorderLevel)
    .map((item) => ({ ...item, shortBy: item.reorderLevel - item.quantityOnHand }))
    .sort((a, b) => b.shortBy - a.shortBy);
}

/**
 * What each department consumed over a period.
 *
 * Issues count as consumption and returns count against it, so a department
 * that sent stock back is not billed for using it.
 */
export async function consumptionByDepartment({ from, to, itemId = null } = {}) {
  const match = { isActive: true, type: { $in: ['issue', 'return'] } };
  if (from || to) {
    match.occurredAt = {};
    if (from) match.occurredAt.$gte = from;
    if (to) match.occurredAt.$lte = to;
  }
  if (itemId) match.itemId = new InventoryItem.base.Types.ObjectId(String(itemId));

  const rows = await InventoryTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$departmentId',
        // signedQuantity is negative for an issue, so negate to read as "used".
        quantityUsed: { $sum: { $multiply: ['$signedQuantity', -1] } },
        value: {
          $sum: {
            $multiply: [{ $multiply: ['$signedQuantity', -1] }, { $ifNull: ['$unitCost', 0] }],
          },
        },
        movements: { $sum: 1 },
      },
    },
    { $sort: { quantityUsed: -1 } },
  ]);

  const populated = await InventoryItem.base
    .model('Department')
    .find({ _id: { $in: rows.map((row) => row._id).filter(Boolean) } })
    .select('code name')
    .lean();
  const byId = new Map(populated.map((dept) => [String(dept._id), dept]));

  return rows.map((row) => ({
    departmentId: row._id,
    department: byId.get(String(row._id))?.name ?? 'Unassigned',
    departmentCode: byId.get(String(row._id))?.code ?? null,
    quantityUsed: row.quantityUsed,
    value: Math.round(row.value * 100) / 100,
    movements: row.movements,
  }));
}

/** Total value of everything on the shelf. */
export async function stockValuation() {
  const [row] = await InventoryItem.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: null,
        items: { $sum: 1 },
        units: { $sum: '$quantityOnHand' },
        value: { $sum: { $multiply: ['$quantityOnHand', { $ifNull: ['$unitCost', 0] }] } },
      },
    },
  ]);

  return {
    items: row?.items ?? 0,
    units: row?.units ?? 0,
    value: Math.round((row?.value ?? 0) * 100) / 100,
  };
}

export default {
  applyTransaction,
  reconcile,
  lowStockItems,
  consumptionByDepartment,
  stockValuation,
  signedFor,
};
