import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import requireAuth from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import validate, { getQuery } from '../../middleware/validate.js';
import { MODULES } from '../../config/permissions.js';
import { BillingLineItem } from '../../models/index.js';
import { CHARGE_SOURCE_TYPES, LINE_ITEM_STATUSES } from '../../models/BillingLineItem.js';
import asyncHandler from '../../utils/asyncHandler.js';
import sendResponse from '../../utils/sendResponse.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
} from '../../utils/queryHelpers.js';
import { extendListQuery, optionalObjectId } from '../../utils/commonSchemas.js';

/**
 * Read-only window onto the shared billing ledger.
 *
 * Phase 8 adds invoices, payments and the write side. This exists now so the
 * charges raised by Phase 4 (lab) are inspectable and so the encounter view can
 * show a running total.
 */
const router = Router();

router.use(requireAuth);

const listLineItemsQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  sourceType: z.enum(CHARGE_SOURCE_TYPES).optional(),
  status: z.enum(LINE_ITEM_STATUSES).optional(),
});

const listLineItems = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-chargedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.sourceType ? { sourceType: query.sourceType } : null,
    query.status ? { status: query.status } : null,
  );

  // Aggregation pipelines bypass Mongoose casting, so ObjectId-valued filters
  // must be cast explicitly — a raw string never matches a stored ObjectId.
  const aggregateMatch = {
    isActive: true,
    ...(query.patientId ? { patientId: new Types.ObjectId(query.patientId) } : {}),
    ...(query.encounterId ? { encounterId: new Types.ObjectId(query.encounterId) } : {}),
    ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total, totals] = await Promise.all([
    BillingLineItem.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .populate({ path: 'departmentId', select: 'code name' })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    BillingLineItem.countDocuments(filter),
    BillingLineItem.aggregate([
      { $match: aggregateMatch },
      { $group: { _id: '$status', amount: { $sum: '$lineTotal' }, count: { $sum: 1 } } },
    ]),
  ]);

  // Always present every status key so clients can read .unbilled.amount safely.
  const summary = LINE_ITEM_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: { amount: 0, count: 0 } }),
    {},
  );
  for (const row of totals) {
    summary[row._id] = { amount: Math.round(row.amount * 100) / 100, count: row.count };
  }

  return sendResponse(res, {
    data: items,
    meta: { ...buildMeta({ page, limit, total }), summary },
  });
});

router.get(
  '/line-items',
  requirePermission(MODULES.BILLING, 'view'),
  validate({ query: listLineItemsQuery }),
  listLineItems,
);

export default router;
