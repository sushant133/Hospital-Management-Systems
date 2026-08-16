import { Ward, Bed, Department, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { can, MODULES } from '../config/permissions.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  searchFilter,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';

const POPULATE = [
  { path: 'departmentId', select: 'code name' },
  { path: 'inChargeId', select: 'firstName lastName role' },
];

/** Occupancy counts per ward, keyed by ward id. */
async function occupancyByWard(wardIds) {
  const rows = await Bed.aggregate([
    { $match: { wardId: { $in: wardIds }, isActive: true } },
    { $group: { _id: { wardId: '$wardId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const map = new Map();
  for (const row of rows) {
    const key = String(row._id.wardId);
    if (!map.has(key)) {
      map.set(key, { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, cleaning: 0 });
    }
    const entry = map.get(key);
    entry.total += row.count;
    entry[row._id.status] = row.count;
  }
  return map;
}

/** Recalculate the denormalized totalBeds counter on a ward. */
async function syncWardBedCount(wardId) {
  const total = await Bed.countDocuments({ wardId, isActive: true });
  await Ward.findByIdAndUpdate(wardId, { totalBeds: total });
  return total;
}

/** GET /wards */
export const listWards = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.type ? { type: query.type } : null,
    searchFilter(query.search, ['name', 'code']),
  );

  const [wards, total] = await Promise.all([
    Ward.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    Ward.countDocuments(filter),
  ]);

  const occupancy = await occupancyByWard(wards.map((w) => w._id));
  const data = wards.map((w) => ({
    ...w,
    occupancy: occupancy.get(String(w._id)) ?? {
      total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, cleaning: 0,
    },
  }));

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

/** GET /wards/:id — ward with its bed roster. */
export const getWard = asyncHandler(async (req, res) => {
  const ward = await Ward.findById(req.params.id).populate(POPULATE);
  if (!ward) throw ApiError.notFound('Ward not found');

  const beds = await Bed.find({ wardId: ward._id, isActive: true })
    .populate({ path: 'currentPatientId', select: 'mrn firstName lastName' })
    .sort({ bedNumber: 1 })
    .lean();

  const occupancy = (await occupancyByWard([ward._id])).get(String(ward._id)) ?? {
    total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, cleaning: 0,
  };

  return sendResponse(res, { data: { ...ward.toJSON(), beds, occupancy } });
});

/** POST /wards — admin only. */
export const createWard = asyncHandler(async (req, res) => {
  const { departmentId, inChargeId, ...rest } = req.body;

  const existing = await Ward.findOne({ code: rest.code });
  if (existing) {
    throw ApiError.conflict('A ward with this code already exists', {
      details: [{ field: 'code', message: 'Already in use' }],
    });
  }

  await assertDepartmentExists(departmentId);
  if (inChargeId) await assertUserExists(inChargeId);

  const ward = await Ward.create({
    ...rest,
    departmentId,
    inChargeId: inChargeId || null,
    totalBeds: 0,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await ward.populate(POPULATE);
  return sendCreated(res, { message: 'Ward created', data: ward });
});

/** PATCH /wards/:id — admin only. */
export const updateWard = asyncHandler(async (req, res) => {
  const ward = await Ward.findById(req.params.id);
  if (!ward) throw ApiError.notFound('Ward not found');

  const { code, departmentId, inChargeId, ...rest } = req.body;

  if (code && code !== ward.code) {
    const clash = await Ward.findOne({ code, _id: { $ne: ward._id } });
    if (clash) {
      throw ApiError.conflict('A ward with this code already exists', {
        details: [{ field: 'code', message: 'Already in use' }],
      });
    }
    ward.code = code;
  }

  if (departmentId) {
    await assertDepartmentExists(departmentId);
    ward.departmentId = departmentId;
  }

  if (inChargeId !== undefined) {
    if (inChargeId) await assertUserExists(inChargeId);
    ward.inChargeId = inChargeId || null;
  }

  Object.assign(ward, rest);
  ward.updatedBy = req.user._id;
  await ward.save();

  await ward.populate(POPULATE);
  return sendResponse(res, { message: 'Ward updated', data: ward });
});

/** DELETE /wards/:id — soft delete, refused while any bed is occupied. */
export const deleteWard = asyncHandler(async (req, res) => {
  const ward = await Ward.findById(req.params.id);
  if (!ward) throw ApiError.notFound('Ward not found');

  const occupied = await Bed.countDocuments({
    wardId: ward._id,
    isActive: true,
    status: { $in: ['occupied', 'reserved'] },
  });

  if (occupied > 0) {
    throw ApiError.conflict(
      `Cannot deactivate a ward with ${occupied} occupied or reserved bed(s).`,
      { code: 'WARD_HAS_OCCUPIED_BEDS' },
    );
  }

  // Cascade the soft delete to the ward's beds so they disappear from
  // "available beds" queries.
  await Bed.updateMany({ wardId: ward._id, isActive: true }, softDeletePatch(req.user));

  Object.assign(ward, softDeletePatch(req.user));
  ward.totalBeds = 0;
  await ward.save();

  return sendResponse(res, { message: 'Ward deactivated', data: { id: ward._id } });
});

/** PATCH /wards/:id/restore — admin only. Beds are NOT auto-restored. */
export const restoreWard = asyncHandler(async (req, res) => {
  const ward = await Ward.findById(req.params.id);
  if (!ward) throw ApiError.notFound('Ward not found');

  await ward.restore(req.user);
  await syncWardBedCount(ward._id);

  return sendResponse(res, {
    message: 'Ward restored. Its beds remain deactivated — restore them individually.',
    data: ward,
  });
});

// ---------------------------------------------------------------- Beds ----

/** GET /wards/:wardId/beds */
export const listBeds = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  await assertWardExists(req.params.wardId);

  const filter = andFilters(
    { wardId: req.params.wardId },
    query.includeInactive && req.user.role === 'admin' ? {} : { isActive: true },
    query.status ? { status: query.status } : null,
  );

  const beds = await Bed.find(filter)
    .populate({ path: 'currentPatientId', select: 'mrn firstName lastName' })
    .sort({ bedNumber: 1 })
    .lean();

  return sendResponse(res, { data: beds });
});

/** POST /wards/:wardId/beds — admin only. */
export const createBed = asyncHandler(async (req, res) => {
  const { wardId } = req.params;
  await assertWardExists(wardId);

  const clash = await Bed.findOne({ wardId, bedNumber: req.body.bedNumber });
  if (clash) {
    throw ApiError.conflict(`Bed "${req.body.bedNumber}" already exists in this ward`, {
      details: [{ field: 'bedNumber', message: 'Already in use in this ward' }],
    });
  }

  const bed = await Bed.create({
    ...req.body,
    wardId,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await syncWardBedCount(wardId);
  return sendCreated(res, { message: 'Bed created', data: bed });
});

/** POST /wards/:wardId/beds/bulk — create a numbered range. Admin only. */
export const createBedRange = asyncHandler(async (req, res) => {
  const { wardId } = req.params;
  await assertWardExists(wardId);

  const { prefix, from, to, dailyRate } = req.body;

  const numbers = [];
  for (let i = from; i <= to; i += 1) numbers.push(`${prefix}${i}`);

  const existing = await Bed.find({ wardId, bedNumber: { $in: numbers } })
    .select('bedNumber')
    .lean();
  const taken = new Set(existing.map((b) => b.bedNumber));

  const toCreate = numbers
    .filter((n) => !taken.has(n))
    .map((bedNumber) => ({
      bedNumber,
      wardId,
      status: 'available',
      dailyRate,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    }));

  if (toCreate.length === 0) {
    throw ApiError.conflict('All bed numbers in that range already exist in this ward', {
      code: 'NO_NEW_BEDS',
    });
  }

  const created = await Bed.insertMany(toCreate);
  const total = await syncWardBedCount(wardId);

  return sendCreated(res, {
    message: `Created ${created.length} bed(s)${taken.size ? `, skipped ${taken.size} existing` : ''}`,
    data: created,
    meta: { created: created.length, skipped: taken.size, wardTotalBeds: total },
  });
});

/** PATCH /wards/:wardId/beds/:bedId — admin only. */
export const updateBed = asyncHandler(async (req, res) => {
  const { wardId, bedId } = req.params;
  const bed = await Bed.findOne({ _id: bedId, wardId });
  if (!bed) throw ApiError.notFound('Bed not found in this ward');

  const { bedNumber, status, ...rest } = req.body;

  /**
   * This route is gated on `beds.changeStatus`, which nurses hold so they can
   * mark a bed for cleaning or maintenance. Everything else on a bed — its
   * number, daily rate, notes — is configuration and needs `beds.edit`.
   * Without this check, granting `changeStatus` would quietly hand out the
   * ability to reprice a bed.
   */
  const touchesConfiguration = bedNumber !== undefined || Object.keys(rest).length > 0;
  if (touchesConfiguration && !can(req.user.role, MODULES.BEDS, 'edit')) {
    throw ApiError.forbidden(
      'Your role may only change a bed’s status, not its number, rate or notes.',
      { code: 'INSUFFICIENT_PERMISSION', details: { module: MODULES.BEDS, action: 'edit' } },
    );
  }

  if (bedNumber && bedNumber !== bed.bedNumber) {
    const clash = await Bed.findOne({ wardId, bedNumber, _id: { $ne: bed._id } });
    if (clash) {
      throw ApiError.conflict(`Bed "${bedNumber}" already exists in this ward`, {
        details: [{ field: 'bedNumber', message: 'Already in use in this ward' }],
      });
    }
    bed.bedNumber = bedNumber;
  }

  if (status && status !== bed.status) {
    // Admission/discharge owns the occupied<->available transition (Phase 3).
    // Manual edits must not orphan a patient reference.
    if (bed.status === 'occupied' && bed.currentPatientId) {
      throw ApiError.conflict(
        'This bed is occupied. Discharge or transfer the patient before changing its status.',
        { code: 'BED_OCCUPIED' },
      );
    }
    if (status === 'occupied') {
      throw ApiError.badRequest(
        'Beds are marked occupied by the admission workflow, not manually.',
        { code: 'USE_ADMISSION_WORKFLOW' },
      );
    }
    bed.status = status;
  }

  Object.assign(bed, rest);
  bed.updatedBy = req.user._id;
  await bed.save();

  return sendResponse(res, { message: 'Bed updated', data: bed });
});

/** DELETE /wards/:wardId/beds/:bedId — soft delete. Admin only. */
export const deleteBed = asyncHandler(async (req, res) => {
  const { wardId, bedId } = req.params;
  const bed = await Bed.findOne({ _id: bedId, wardId });
  if (!bed) throw ApiError.notFound('Bed not found in this ward');

  if (bed.status === 'occupied' || bed.currentPatientId) {
    throw ApiError.conflict('Cannot remove an occupied bed', { code: 'BED_OCCUPIED' });
  }

  Object.assign(bed, softDeletePatch(req.user));
  await bed.save();
  await syncWardBedCount(wardId);

  return sendResponse(res, { message: 'Bed removed', data: { id: bed._id } });
});

// ------------------------------------------------------------ helpers ----

async function assertWardExists(wardId) {
  const ward = await Ward.findOne({ _id: wardId, isActive: true }).lean();
  if (!ward) throw ApiError.notFound('Ward not found');
  return ward;
}

async function assertDepartmentExists(departmentId) {
  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
  if (!department) {
    throw ApiError.badRequest('The selected department does not exist or is inactive', {
      details: [{ field: 'departmentId', message: 'Invalid department' }],
    });
  }
  return department;
}

async function assertUserExists(userId) {
  const user = await User.findOne({ _id: userId, isActive: true }).lean();
  if (!user) {
    throw ApiError.badRequest('The selected staff member does not exist or is inactive', {
      details: [{ field: 'inChargeId', message: 'Invalid staff member' }],
    });
  }
  return user;
}
