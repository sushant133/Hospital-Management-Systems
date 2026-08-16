import { Device } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter } from '../utils/queryHelpers.js';

export const listDevices = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.kind ? { kind: query.kind } : null,
    searchFilter(query.search, ['code', 'name', 'sendingApplication']),
  );
  const [rows, total] = await Promise.all([
    Device.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Device.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createDevice = asyncHandler(async (req, res) => {
  const existing = await Device.findOne({ code: req.body.code.toUpperCase() });
  if (existing) throw ApiError.conflict('Device code already exists');
  const row = await Device.create({ ...req.body, createdBy: req.user._id, updatedBy: req.user._id });
  return sendCreated(res, { message: `Device ${row.code} registered`, data: row });
});

export const updateDevice = asyncHandler(async (req, res) => {
  const row = await Device.findById(req.params.id);
  if (!row) throw ApiError.notFound('Device not found');
  Object.assign(row, req.body);
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'Device updated', data: row });
});
