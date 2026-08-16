import { Facility } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter } from '../utils/queryHelpers.js';

export const listFacilities = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });
  const filter = andFilters(activeScope(query, req.user), searchFilter(query.search, ['code', 'name']));
  const [rows, total] = await Promise.all([
    Facility.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Facility.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createFacility = asyncHandler(async (req, res) => {
  const existing = await Facility.findOne({ code: req.body.code.toUpperCase() });
  if (existing) throw ApiError.conflict('Facility code already exists');
  if (req.body.isDefault) {
    await Facility.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  }
  const row = await Facility.create({ ...req.body, createdBy: req.user._id, updatedBy: req.user._id });
  return sendCreated(res, { message: `Facility ${row.code} created`, data: row });
});

export const updateFacility = asyncHandler(async (req, res) => {
  const row = await Facility.findById(req.params.id);
  if (!row) throw ApiError.notFound('Facility not found');
  if (req.body.isDefault) {
    await Facility.updateMany({ isDefault: true, _id: { $ne: row._id } }, { $set: { isDefault: false } });
  }
  Object.assign(row, req.body);
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'Facility updated', data: row });
});
