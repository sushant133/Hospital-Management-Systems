import { Drug, DrugBatch } from '../models/index.js';
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
import { stockOnHand, expiringBatches, lowStockDrugs } from '../services/pharmacyService.js';

/**
 * The drug master and the stock behind it.
 *
 * `drugs` is the formulary — what may be prescribed. `drugBatches` is the
 * physical shelf. They are separate because expiry belongs to a delivery, not
 * to a product.
 */

// ------------------------------------------------------------ formulary ----

/** GET /pharmacy/drugs */
export const listDrugs = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.form ? { form: query.form } : null,
    query.isControlled === true ? { isControlled: true } : null,
    searchFilter(query.search, ['name', 'genericName', 'drugCode']),
  );

  const [drugs, total] = await Promise.all([
    Drug.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Drug.countDocuments(filter),
  ]);

  // The formulary is only useful next to what is actually on the shelf.
  const withStock = await Promise.all(
    drugs.map(async (drug) => ({
      ...drug,
      quantityOnHand: await stockOnHand(drug._id),
    })),
  );

  const data = query.lowStockOnly
    ? withStock.filter((drug) => drug.reorderLevel > 0 && drug.quantityOnHand <= drug.reorderLevel)
    : withStock;

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

/** GET /pharmacy/drugs/:id — with its batches. */
export const getDrug = asyncHandler(async (req, res) => {
  const drug = await Drug.findById(req.params.id).lean();
  if (!drug) throw ApiError.notFound('Drug not found');

  const batches = await DrugBatch.find({ drugId: drug._id, isActive: true })
    .sort({ expiryDate: 1 })
    .lean();

  return sendResponse(res, {
    data: { ...drug, batches, quantityOnHand: await stockOnHand(drug._id) },
  });
});

/** POST /pharmacy/drugs */
export const createDrug = asyncHandler(async (req, res) => {
  const existing = await Drug.findOne({ drugCode: req.body.drugCode.toUpperCase() });
  if (existing) {
    throw ApiError.conflict(`A drug with code ${req.body.drugCode} already exists`, {
      code: 'DRUG_CODE_TAKEN',
    });
  }

  const drug = await Drug.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return sendCreated(res, { message: 'Drug added to the formulary', data: drug });
});

/** PATCH /pharmacy/drugs/:id */
export const updateDrug = asyncHandler(async (req, res) => {
  const drug = await Drug.findById(req.params.id);
  if (!drug) throw ApiError.notFound('Drug not found');

  if (req.body.drugCode && req.body.drugCode.toUpperCase() !== drug.drugCode) {
    const clash = await Drug.findOne({ drugCode: req.body.drugCode.toUpperCase() });
    if (clash) {
      throw ApiError.conflict(`A drug with code ${req.body.drugCode} already exists`, {
        code: 'DRUG_CODE_TAKEN',
      });
    }
  }

  Object.assign(drug, req.body);
  drug.updatedBy = req.user._id;
  await drug.save();

  return sendResponse(res, { message: 'Drug updated', data: drug });
});

/** DELETE /pharmacy/drugs/:id — retire from the formulary. */
export const deleteDrug = asyncHandler(async (req, res) => {
  const drug = await Drug.findById(req.params.id);
  if (!drug) throw ApiError.notFound('Drug not found');

  // Retiring a drug that is still on the shelf would strand the stock.
  const remaining = await stockOnHand(drug._id);
  if (remaining > 0) {
    throw ApiError.conflict(
      `Cannot retire ${drug.name} while ${remaining} unit(s) remain in stock. Write the stock off first.`,
      { code: 'DRUG_HAS_STOCK', details: { quantityOnHand: remaining } },
    );
  }

  Object.assign(drug, softDeletePatch(req.user));
  await drug.save();

  return sendResponse(res, { message: 'Drug retired', data: { _id: drug._id } });
});

// --------------------------------------------------------------- batches ----

/** GET /pharmacy/batches */
export const listBatches = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: 'expiryDate' });

  const expiryFilter = {};
  if (query.expiringBefore) expiryFilter.$lte = query.expiringBefore;

  const filter = andFilters(
    activeScope(query, req.user),
    query.drugId ? { drugId: query.drugId } : null,
    query.status ? { status: query.status } : null,
    query.inStockOnly ? { quantityOnHand: { $gt: 0 } } : null,
    Object.keys(expiryFilter).length ? { expiryDate: expiryFilter } : null,
  );

  const [batches, total] = await Promise.all([
    DrugBatch.find(filter)
      .populate({ path: 'drugId', select: 'drugCode name strength unit form' })
      .sort({ expiryDate: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    DrugBatch.countDocuments(filter),
  ]);

  return sendResponse(res, { data: batches, meta: buildMeta({ page, limit, total }) });
});

/** POST /pharmacy/batches — goods receipt. */
export const receiveBatch = asyncHandler(async (req, res) => {
  const drug = await Drug.findOne({ _id: req.body.drugId, isActive: true });
  if (!drug) {
    throw ApiError.badRequest('That drug is not in the formulary', {
      details: [{ field: 'drugId', message: 'Unknown or retired drug' }],
    });
  }

  if (new Date(req.body.expiryDate) <= new Date()) {
    throw ApiError.badRequest('That batch has already expired', {
      details: [{ field: 'expiryDate', message: 'Expiry must be in the future' }],
    });
  }

  const duplicate = await DrugBatch.findOne({ drugId: drug._id, batchNo: req.body.batchNo });
  if (duplicate) {
    throw ApiError.conflict(`Batch ${req.body.batchNo} of ${drug.name} is already recorded`, {
      code: 'BATCH_ALREADY_RECEIVED',
    });
  }

  const batch = await DrugBatch.create({
    ...req.body,
    // Goods in: what arrived is what is on hand.
    quantityOnHand: req.body.quantityReceived,
    status: 'active',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await batch.populate({ path: 'drugId', select: 'drugCode name strength unit' });
  return sendCreated(res, {
    message: `Received ${batch.quantityReceived} unit(s) of ${drug.name}`,
    data: batch,
  });
});

/**
 * POST /pharmacy/batches/:id/adjust — write off, quarantine or correct stock.
 *
 * Gated on `drugBatches.adjust`, separate from `edit`: changing a supplier name
 * and destroying stock are not the same act.
 */
export const adjustBatch = asyncHandler(async (req, res) => {
  const batch = await DrugBatch.findById(req.params.id);
  if (!batch) throw ApiError.notFound('Batch not found');

  const { action, quantity, reason } = req.body;

  if (action === 'write-off') {
    if (quantity > batch.quantityOnHand) {
      throw ApiError.badRequest(
        `Cannot write off ${quantity} — only ${batch.quantityOnHand} on hand`,
        { details: [{ field: 'quantity', message: 'More than is on hand' }] },
      );
    }
    batch.quantityOnHand -= quantity;
    if (batch.quantityOnHand === 0) batch.status = 'depleted';
  } else if (action === 'quarantine') {
    batch.status = 'quarantined';
  } else if (action === 'release') {
    if (batch.isExpired) {
      throw ApiError.conflict('An expired batch cannot be released back into stock', {
        code: 'BATCH_EXPIRED',
      });
    }
    batch.status = batch.quantityOnHand > 0 ? 'active' : 'depleted';
  } else if (action === 'mark-expired') {
    batch.status = 'expired';
  }

  batch.adjustmentNotes = reason;
  batch.updatedBy = req.user._id;
  await batch.save();

  await batch.populate({ path: 'drugId', select: 'drugCode name strength unit' });
  return sendResponse(res, { message: `Batch ${action.replace('-', ' ')} recorded`, data: batch });
});

// ------------------------------------------------------------ monitoring ----

/** GET /pharmacy/alerts — expiry and low-stock, the two things a pharmacy watches. */
export const getAlerts = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const days = query.days ?? 90;

  const [expiring, lowStock] = await Promise.all([
    expiringBatches({ days }),
    lowStockDrugs(),
  ]);

  const now = new Date();
  const alreadyExpired = expiring.filter((batch) => new Date(batch.expiryDate) <= now);

  return sendResponse(res, {
    data: { expiring, lowStock },
    meta: {
      withinDays: days,
      expiringCount: expiring.length,
      expiredCount: alreadyExpired.length,
      lowStockCount: lowStock.length,
      // Value at risk, so the number has a size as well as a count.
      valueAtRisk:
        Math.round(
          expiring.reduce((sum, b) => sum + b.quantityOnHand * (b.costPrice ?? 0), 0) * 100,
        ) / 100,
    },
  });
});
