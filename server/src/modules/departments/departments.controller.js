import { Department, Ward, User, Encounter } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import asyncHandler from '../../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../../utils/sendResponse.js';
import { getQuery } from '../../middleware/validate.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  searchFilter,
  andFilters,
  softDeletePatch,
} from '../../utils/queryHelpers.js';

const POPULATE_HEAD = {
  path: 'headOfDepartmentId',
  select: 'firstName lastName role specialization',
};

/** GET /departments */
export const listDepartments = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    searchFilter(query.search, ['name', 'code', 'description']),
  );

  const [departments, total] = await Promise.all([
    Department.find(filter)
      .populate(POPULATE_HEAD)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Department.countDocuments(filter),
  ]);

  // Ward count per department — cheap enough at this cardinality and saves the
  // client an N+1 round trip on the admin page.
  const wardCounts = await Ward.aggregate([
    { $match: { isActive: true, departmentId: { $in: departments.map((d) => d._id) } } },
    { $group: { _id: '$departmentId', count: { $sum: 1 }, beds: { $sum: '$totalBeds' } } },
  ]);
  const countsById = new Map(wardCounts.map((w) => [String(w._id), w]));

  const data = departments.map((d) => ({
    ...d,
    wardCount: countsById.get(String(d._id))?.count ?? 0,
    bedCount: countsById.get(String(d._id))?.beds ?? 0,
  }));

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

/** GET /departments/:id */
export const getDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id).populate(POPULATE_HEAD);
  if (!department) throw ApiError.notFound('Department not found');

  const wards = await Ward.find({ departmentId: department._id, isActive: true })
    .select('code name type totalBeds')
    .sort({ name: 1 })
    .lean();

  return sendResponse(res, { data: { ...department.toJSON(), wards } });
});

/** POST /departments — admin only. */
export const createDepartment = asyncHandler(async (req, res) => {
  const { headOfDepartmentId, ...rest } = req.body;

  const existing = await Department.findOne({ code: rest.code });
  if (existing) {
    throw ApiError.conflict('A department with this code already exists', {
      details: [{ field: 'code', message: 'Already in use' }],
    });
  }

  if (headOfDepartmentId) await assertUserExists(headOfDepartmentId);

  const department = await Department.create({
    ...rest,
    headOfDepartmentId: headOfDepartmentId || null,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await department.populate(POPULATE_HEAD);
  return sendCreated(res, { message: 'Department created', data: department });
});

/** PATCH /departments/:id — admin only. */
export const updateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found');

  const { code, headOfDepartmentId, ...rest } = req.body;

  if (code && code !== department.code) {
    const clash = await Department.findOne({ code, _id: { $ne: department._id } });
    if (clash) {
      throw ApiError.conflict('A department with this code already exists', {
        details: [{ field: 'code', message: 'Already in use' }],
      });
    }
    department.code = code;
  }

  if (headOfDepartmentId !== undefined) {
    if (headOfDepartmentId) await assertUserExists(headOfDepartmentId);
    department.headOfDepartmentId = headOfDepartmentId || null;
  }

  Object.assign(department, rest);
  department.updatedBy = req.user._id;
  await department.save();

  await department.populate(POPULATE_HEAD);
  return sendResponse(res, { message: 'Department updated', data: department });
});

/**
 * DELETE /departments/:id — soft delete.
 * Refused while active wards or open encounters still reference it, so the
 * reference graph never points at a deactivated parent.
 */
export const deleteDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found');

  const [wardCount, openEncounters] = await Promise.all([
    Ward.countDocuments({ departmentId: department._id, isActive: true }),
    Encounter.countDocuments({
      departmentId: department._id,
      status: { $in: ['open', 'admitted'] },
      isActive: true,
    }),
  ]);

  if (wardCount > 0) {
    throw ApiError.conflict(
      `Cannot deactivate a department with ${wardCount} active ward(s). Deactivate the wards first.`,
      { code: 'DEPARTMENT_HAS_WARDS' },
    );
  }

  if (openEncounters > 0) {
    throw ApiError.conflict(
      `Cannot deactivate a department with ${openEncounters} open visit(s).`,
      { code: 'DEPARTMENT_HAS_OPEN_ENCOUNTERS' },
    );
  }

  Object.assign(department, softDeletePatch(req.user));
  await department.save();

  return sendResponse(res, { message: 'Department deactivated', data: { id: department._id } });
});

/** PATCH /departments/:id/restore — admin only. */
export const restoreDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found');

  await department.restore(req.user);
  return sendResponse(res, { message: 'Department restored', data: department });
});

async function assertUserExists(userId) {
  const user = await User.findOne({ _id: userId, isActive: true }).lean();
  if (!user) {
    throw ApiError.badRequest('The selected head of department does not exist or is inactive', {
      details: [{ field: 'headOfDepartmentId', message: 'Invalid staff member' }],
    });
  }
  return user;
}
