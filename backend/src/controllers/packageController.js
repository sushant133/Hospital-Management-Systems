import { BillingPackage, Encounter, Department } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, searchFilter, softDeletePatch } from '../utils/queryHelpers.js';
import { createCharges } from '../services/billingService.js';
import config from '../config/env.js';

const POPULATE = [{ path: 'departmentId', select: 'code name' }];

export const listPackages = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.departmentId ? { departmentId: query.departmentId } : null,
    searchFilter(query.search, ['code', 'name']),
  );
  const [rows, total] = await Promise.all([
    BillingPackage.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    BillingPackage.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getPackage = asyncHandler(async (req, res) => {
  const row = await BillingPackage.findById(req.params.id).populate(POPULATE);
  if (!row) throw ApiError.notFound('Package not found');
  return sendResponse(res, { data: row });
});

export const createPackage = asyncHandler(async (req, res) => {
  const existing = await BillingPackage.findOne({ code: req.body.code.toUpperCase() });
  if (existing) {
    throw ApiError.conflict(`A package with code ${req.body.code} already exists`, { code: 'PACKAGE_EXISTS' });
  }
  if (req.body.departmentId) {
    const dept = await Department.findById(req.body.departmentId).select('_id').lean();
    if (!dept) throw ApiError.badRequest('Invalid department', { details: [{ field: 'departmentId' }] });
  }
  const row = await BillingPackage.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await row.populate(POPULATE);
  return sendCreated(res, { message: `Package ${row.code} created`, data: row });
});

export const updatePackage = asyncHandler(async (req, res) => {
  const row = await BillingPackage.findById(req.params.id);
  if (!row) throw ApiError.notFound('Package not found');
  Object.assign(row, req.body);
  row.updatedBy = req.user._id;
  await row.save();
  await row.populate(POPULATE);
  return sendResponse(res, { message: 'Package updated', data: row });
});

export const deletePackage = asyncHandler(async (req, res) => {
  const row = await BillingPackage.findById(req.params.id);
  if (!row) throw ApiError.notFound('Package not found');
  Object.assign(row, softDeletePatch(req.user));
  await row.save();
  return sendResponse(res, { message: 'Package retired', data: { id: row._id } });
});

export const applyPackage = asyncHandler(async (req, res) => {
  const pkg = await BillingPackage.findOne({ _id: req.params.id, isActive: true });
  if (!pkg) throw ApiError.notFound('Package not found');

  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('That visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }
  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict('Cannot charge a closed visit', { code: 'ENCOUNTER_CLOSED' });
  }

  const fallbackTax = config.defaultTaxPercent || 0;
  const lines = await createCharges({
    patientId: encounter.patientId,
    encounterId: encounter._id,
    sourceType: 'procedure',
    sourceId: pkg._id,
    sourceRef: pkg.code,
    user: req.user,
    items: pkg.items.map((item) => ({
      itemCode: item.itemCode,
      description: `${pkg.name}: ${item.description}`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxPercent: item.taxPercent || fallbackTax,
      taxCode: item.taxCode || '',
      departmentId: pkg.departmentId,
    })),
  });

  return sendCreated(res, {
    message: `Applied ${pkg.code} — ${lines.length} charge(s)`,
    data: { package: pkg, lines },
  });
});
