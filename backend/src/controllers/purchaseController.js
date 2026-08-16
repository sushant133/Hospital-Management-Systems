import { Supplier, PurchaseOrder, PO_TRANSITIONS } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter } from '../utils/queryHelpers.js';
import { applyTransaction } from '../services/inventoryService.js';

function assertPoTransition(from, to) {
  const allowed = PO_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot move a PO from "${from}" to "${to}"`, { code: 'INVALID_STATUS_TRANSITION' });
  }
}

export const listSuppliers = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });
  const filter = andFilters(activeScope(query, req.user), searchFilter(query.search, ['code', 'name']));
  const [rows, total] = await Promise.all([
    Supplier.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Supplier.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const existing = await Supplier.findOne({ code: req.body.code.toUpperCase() });
  if (existing) throw ApiError.conflict('Supplier code already exists');
  const row = await Supplier.create({ ...req.body, createdBy: req.user._id, updatedBy: req.user._id });
  return sendCreated(res, { message: `Supplier ${row.code} created`, data: row });
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const row = await Supplier.findById(req.params.id);
  if (!row) throw ApiError.notFound('Supplier not found');
  Object.assign(row, req.body);
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'Supplier updated', data: row });
});

export const listOrders = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.supplierId ? { supplierId: query.supplierId } : null,
  );
  const [rows, total] = await Promise.all([
    PurchaseOrder.find(filter)
      .populate({ path: 'supplierId', select: 'code name' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    PurchaseOrder.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getOrder = asyncHandler(async (req, res) => {
  const row = await PurchaseOrder.findById(req.params.id).populate({ path: 'supplierId', select: 'code name phone' });
  if (!row) throw ApiError.notFound('Purchase order not found');
  return sendResponse(res, { data: row });
});

export const createOrder = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOne({ _id: req.body.supplierId, isActive: true }).lean();
  if (!supplier) throw ApiError.badRequest('Invalid supplier');
  const row = await PurchaseOrder.create({
    ...req.body,
    status: 'draft',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await row.populate({ path: 'supplierId', select: 'code name' });
  return sendCreated(res, { message: `PO ${row.poNumber} drafted`, data: row });
});

export const submitOrder = asyncHandler(async (req, res) => {
  const row = await PurchaseOrder.findById(req.params.id);
  if (!row) throw ApiError.notFound('Purchase order not found');
  assertPoTransition(row.status, 'submitted');
  row.status = 'submitted';
  row.submittedAt = new Date();
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'PO submitted to supplier', data: row });
});

export const receiveOrder = asyncHandler(async (req, res) => {
  const row = await PurchaseOrder.findById(req.params.id);
  if (!row) throw ApiError.notFound('Purchase order not found');
  if (!['submitted', 'partial'].includes(row.status)) {
    throw ApiError.conflict('Only a submitted PO can be received');
  }

  const receipts = req.body.lines ?? [];
  for (const receipt of receipts) {
    const line = row.lines.id(receipt.lineId);
    if (!line) continue;
    const qty = Number(receipt.quantity || 0);
    if (qty <= 0) continue;
    line.quantityReceived = Math.min(line.quantity, (line.quantityReceived || 0) + qty);
    if (line.inventoryItemId && qty > 0) {
      await applyTransaction({
        itemId: line.inventoryItemId,
        type: 'receipt',
        quantity: qty,
        reference: row.poNumber,
        reason: `PO ${row.poNumber}`,
        user: req.user,
      });
    }
  }

  const allIn = row.lines.every((line) => line.quantityReceived >= line.quantity);
  const anyIn = row.lines.some((line) => line.quantityReceived > 0);
  const next = allIn ? 'received' : anyIn ? 'partial' : row.status;
  if (next !== row.status) assertPoTransition(row.status, next);
  row.status = next;
  if (allIn) row.receivedAt = new Date();
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: allIn ? 'PO fully received' : 'Partial receipt recorded', data: row });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  const row = await PurchaseOrder.findById(req.params.id);
  if (!row) throw ApiError.notFound('Purchase order not found');
  assertPoTransition(row.status, 'cancelled');
  row.status = 'cancelled';
  row.notes = [row.notes, req.body.reason].filter(Boolean).join('\n');
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'PO cancelled', data: row });
});
