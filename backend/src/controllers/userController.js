import { User, Department } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  searchFilter,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';

const POPULATE = { path: 'departmentId', select: 'code name' };

/** GET /users — paginated staff directory. Admin only. */
export const listUsers = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination(query);

  const filter = andFilters(
    activeScope(query, req.user),
    query.role ? { role: query.role } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    searchFilter(query.search, ['firstName', 'lastName', 'email', 'employeeId']),
  );

  const [users, total] = await Promise.all([
    User.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return sendResponse(res, { data: users, meta: buildMeta({ page, limit, total }) });
});

/**
 * GET /users/directory — who works here, for assignment dropdowns.
 *
 * Deliberately projects a narrow field list rather than reusing listUsers: this
 * is readable by every signed-in role, so it must not leak email, employeeId,
 * mustChangePassword or anything else from the employment record.
 */
export const listDirectory = asyncHandler(async (req, res) => {
  const query = getQuery(req);

  const filter = andFilters(
    { isActive: true },
    query.role ? { role: query.role } : null,
    query.departmentId ? { departmentId: query.departmentId } : null,
    searchFilter(query.search, ['firstName', 'lastName']),
  );

  const staff = await User.find(filter)
    .select('firstName lastName role specialization departmentId')
    .populate({ path: 'departmentId', select: 'code name' })
    .sort({ lastName: 1, firstName: 1 })
    .limit(query.limit)
    .lean();

  return sendResponse(res, { data: staff, meta: { total: staff.length } });
});

/** GET /users/:id */
export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate(POPULATE);
  if (!user) throw ApiError.notFound('Staff member not found');
  return sendResponse(res, { data: user });
});

/** POST /users — create a staff account. Admin only. */
export const createUser = asyncHandler(async (req, res) => {
  const { password: plainPassword, departmentId, ...rest } = req.body;

  const existing = await User.findOne({ email: rest.email });
  if (existing) {
    throw ApiError.conflict('A staff account with this email already exists', {
      details: [{ field: 'email', message: 'Already in use' }],
    });
  }

  if (departmentId) await assertDepartmentExists(departmentId);

  const user = await User.create({
    ...rest,
    departmentId: departmentId || null,
    passwordHash: await User.hashPassword(plainPassword),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await user.populate(POPULATE);
  return sendCreated(res, { message: 'Staff account created', data: user });
});

/** PATCH /users/:id — Admin only. */
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('Staff member not found');

  const { email, departmentId, ...rest } = req.body;

  if (email && email !== user.email) {
    const clash = await User.findOne({ email, _id: { $ne: user._id } });
    if (clash) {
      throw ApiError.conflict('A staff account with this email already exists', {
        details: [{ field: 'email', message: 'Already in use' }],
      });
    }
    user.email = email;
  }

  if (departmentId !== undefined) {
    if (departmentId) await assertDepartmentExists(departmentId);
    user.departmentId = departmentId || null;
  }

  // An admin must not remove their own admin role and lock themselves out.
  if (rest.role && rest.role !== user.role && String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  Object.assign(user, rest);
  user.updatedBy = req.user._id;
  await user.save();

  await user.populate(POPULATE);
  return sendResponse(res, { message: 'Staff account updated', data: user });
});

/** DELETE /users/:id — soft delete + revoke sessions. Admin only. */
export const deactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('Staff member not found');

  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  // Bumping tokenVersion invalidates every token this user still holds.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  Object.assign(user, softDeletePatch(req.user));
  await user.save();

  return sendResponse(res, { message: 'Staff account deactivated', data: { id: user._id } });
});

/** PATCH /users/:id/restore — Admin only. */
export const restoreUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('Staff member not found');

  await user.restore(req.user);
  await user.populate(POPULATE);

  return sendResponse(res, { message: 'Staff account restored', data: user });
});

/** POST /users/:id/reset-password — Admin only. Revokes existing sessions. */
export const resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('Staff member not found');

  user.passwordHash = await User.hashPassword(req.body.newPassword);
  user.mustChangePassword = req.body.mustChangePassword ?? true;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.updatedBy = req.user._id;
  await user.save();

  return sendResponse(res, {
    message: 'Password reset. The user has been signed out of all sessions.',
    data: { id: user._id },
  });
});

async function assertDepartmentExists(departmentId) {
  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
  if (!department) {
    throw ApiError.badRequest('The selected department does not exist or is inactive', {
      details: [{ field: 'departmentId', message: 'Invalid department' }],
    });
  }
  return department;
}
