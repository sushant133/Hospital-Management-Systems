import { InventoryItem, InventoryTransaction, Department } from '../models/index.js';
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
  softDeletePatch,
} from '../utils/queryHelpers.js';
import {
  applyTransaction,
  reconcile,
  lowStockItems,
  consumptionByDepartment,
  stockValuation,
} from '../services/inventoryService.js';

const TRANSACTION_POPULATE = [
  { path: 'itemId', select: 'itemCode name unit category' },
  { path: 'departmentId', select: 'code name' },
  { path: 'performedBy', select: 'firstName lastName role' },
];

/**
 * Non-drug stock: the catalogue, the ledger, and what the wards are consuming.
 */

// ------------------------------------------------------------------ items ----

/** GET /inventory/items */
export const listItems = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.category ? { category: query.category } : null,
    query.isAsset === true ? { isAsset: true } : null,
    query.location ? { location: query.location } : null,
    searchFilter(query.search, ['name', 'itemCode', 'description']),
  );

  const [items, total] = await Promise.all([
    InventoryItem.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    InventoryItem.countDocuments(filter),
  ]);

  const data = query.lowStockOnly
    ? items.filter((item) => item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel)
    : items;

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

/** GET /inventory/items/:id — with its recent movements. */
export const getItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id).lean({ virtuals: true });
  if (!item) throw ApiError.notFound('Item not found');

  const transactions = await InventoryTransaction.find({ itemId: item._id, isActive: true })
    .populate(TRANSACTION_POPULATE)
    .sort({ occurredAt: -1 })
    .limit(50)
    .lean();

  return sendResponse(res, {
    data: { ...item, transactions },
    // Proof the running balance still matches the ledger behind it.
    meta: { reconciliation: await reconcile(item._id) },
  });
});

/** POST /inventory/items */
export const createItem = asyncHandler(async (req, res) => {
  const existing = await InventoryItem.findOne({ itemCode: req.body.itemCode.toUpperCase() });
  if (existing) {
    throw ApiError.conflict(`An item with code ${req.body.itemCode} already exists`, {
      code: 'ITEM_CODE_TAKEN',
    });
  }

  const item = await InventoryItem.create({
    ...req.body,
    // Stock arrives through a receipt, never by typing a number into the item.
    quantityOnHand: 0,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, {
    message: 'Item added — record a receipt to bring stock in',
    data: item,
  });
});

/** PATCH /inventory/items/:id */
export const updateItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');

  if (req.body.itemCode && req.body.itemCode.toUpperCase() !== item.itemCode) {
    const clash = await InventoryItem.findOne({ itemCode: req.body.itemCode.toUpperCase() });
    if (clash) {
      throw ApiError.conflict(`An item with code ${req.body.itemCode} already exists`, {
        code: 'ITEM_CODE_TAKEN',
      });
    }
  }

  // The balance is the ledger's to move, not an editable field.
  const { quantityOnHand, ...rest } = req.body;

  Object.assign(item, rest);
  item.updatedBy = req.user._id;
  await item.save();

  return sendResponse(res, { message: 'Item updated', data: item });
});

/** DELETE /inventory/items/:id — retire from the catalogue. */
export const deleteItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');

  if (item.quantityOnHand > 0) {
    throw ApiError.conflict(
      `Cannot retire ${item.name} while ${item.quantityOnHand} ${item.unit}(s) remain in stock. Issue or write the stock off first.`,
      { code: 'ITEM_HAS_STOCK', details: { quantityOnHand: item.quantityOnHand } },
    );
  }

  Object.assign(item, softDeletePatch(req.user));
  await item.save();

  return sendResponse(res, { message: 'Item retired', data: { _id: item._id } });
});

// ----------------------------------------------------------- transactions ----

/**
 * POST /inventory/transactions — record a stock movement.
 *
 * One endpoint for all four types: receipts, issues to a department,
 * adjustments and returns are the same act — moving stock and writing it down —
 * differing only in direction and what they require alongside.
 */
export const recordTransaction = asyncHandler(async (req, res) => {
  const { itemId, type, quantity, direction, departmentId, reference, reason, occurredAt } = req.body;

  if (departmentId) {
    const department = await Department.exists({ _id: departmentId, isActive: true });
    if (!department) {
      throw ApiError.badRequest('That department does not exist or is inactive', {
        details: [{ field: 'departmentId', message: 'Invalid department' }],
      });
    }
  }

  const { item, transaction } = await applyTransaction({
    itemId,
    type,
    quantity,
    direction,
    departmentId: departmentId ?? null,
    reference: reference ?? '',
    reason: reason ?? '',
    occurredAt: occurredAt ?? new Date(),
    user: req.user,
  });

  await transaction.populate(TRANSACTION_POPULATE);

  return sendCreated(res, {
    message: `${type[0].toUpperCase()}${type.slice(1)} recorded — ${item.name} now at ${item.quantityOnHand} ${item.unit}(s)`,
    data: transaction,
    meta: {
      quantityOnHand: item.quantityOnHand,
      needsReorder: item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel,
    },
  });
});

/** GET /inventory/transactions — the ledger. */
export const listTransactions = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-occurredAt' });

  const dateRange = {};
  if (query.from) dateRange.$gte = query.from;
  if (query.to) dateRange.$lte = query.to;

  const filter = andFilters(
    activeScope(query, req.user),
    query.itemId ? { itemId: query.itemId } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.type ? { type: query.type } : null,
    Object.keys(dateRange).length ? { occurredAt: dateRange } : null,
  );

  const [transactions, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .populate(TRANSACTION_POPULATE)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InventoryTransaction.countDocuments(filter),
  ]);

  return sendResponse(res, { data: transactions, meta: buildMeta({ page, limit, total }) });
});

// -------------------------------------------------------------- reporting ----

/** GET /inventory/alerts — what needs reordering, and what the store is worth. */
export const getAlerts = asyncHandler(async (req, res) => {
  const [lowStock, valuation] = await Promise.all([lowStockItems(), stockValuation()]);

  return sendResponse(res, {
    data: { lowStock },
    meta: {
      lowStockCount: lowStock.length,
      outOfStockCount: lowStock.filter((item) => item.quantityOnHand === 0).length,
      valuation,
    },
  });
});

/**
 * GET /inventory/consumption — what each department used over a period.
 *
 * Returns net of returns, so a ward that sent stock back is not counted as
 * having consumed it.
 */
export const getConsumption = asyncHandler(async (req, res) => {
  const query = getQuery(req);

  const rows = await consumptionByDepartment({
    from: query.from,
    to: query.to,
    itemId: query.itemId ?? null,
  });

  return sendResponse(res, {
    data: rows,
    meta: {
      from: query.from ?? null,
      to: query.to ?? null,
      totalUnits: rows.reduce((sum, row) => sum + row.quantityUsed, 0),
      totalValue: Math.round(rows.reduce((sum, row) => sum + row.value, 0) * 100) / 100,
    },
  });
});
