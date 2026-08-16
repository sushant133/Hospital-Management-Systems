import {
  ShiftRoster,
  ShiftAssignment,
  Department,
  User,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';
import {
  mondayOf,
  sundayOf,
  isDateInWeek,
  coverageFrom,
  startOfDay,
} from '../services/rosterService.js';

const ROSTER_POPULATE = [
  { path: 'departmentId', select: 'code name' },
  { path: 'publishedBy', select: 'firstName lastName' },
];

const ASSIGNMENT_POPULATE = [
  { path: 'userId', select: 'firstName lastName role departmentId' },
];

function departmentFilter(departmentId) {
  if (departmentId === undefined) return null;
  return { departmentId: departmentId || null };
}

async function loadRoster(id) {
  const roster = await ShiftRoster.findOne({ _id: id, isActive: true });
  if (!roster) throw ApiError.notFound('Roster not found');
  return roster;
}

function assertDraft(roster) {
  if (roster.status === 'published') {
    throw ApiError.conflict('Unpublish the roster before changing assignments', {
      code: 'ROSTER_PUBLISHED',
    });
  }
}

async function assignmentsFor(rosterId) {
  return ShiftAssignment.find({ rosterId, isActive: true })
    .populate(ASSIGNMENT_POPULATE)
    .sort({ date: 1, shift: 1 })
    .lean();
}

async function withAssignments(roster) {
  const assignments = await assignmentsFor(roster._id);
  const json = typeof roster.toJSON === 'function' ? roster.toJSON() : roster;
  return {
    ...json,
    assignments,
    coverage: coverageFrom(assignments, roster.weekStart),
  };
}

// ---------------------------------------------------------------- listing ----

/** GET /attendance/rosters */
export const listRosters = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-weekStart',
  });

  const week = query.weekStart ? mondayOf(query.weekStart) : null;

  const filter = andFilters(
    activeScope(query, req.user),
    departmentFilter(query.departmentId),
    query.status ? { status: query.status } : null,
    week ? { weekStart: week } : null,
  );

  const [rosters, total] = await Promise.all([
    ShiftRoster.find(filter).populate(ROSTER_POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    ShiftRoster.countDocuments(filter),
  ]);

  const counts = await ShiftAssignment.aggregate([
    { $match: { rosterId: { $in: rosters.map((r) => r._id) }, isActive: true } },
    { $group: { _id: '$rosterId', count: { $sum: 1 } } },
  ]);
  const countByRoster = new Map(counts.map((row) => [String(row._id), row.count]));

  return sendResponse(res, {
    data: rosters.map((roster) => ({
      ...roster,
      assignmentCount: countByRoster.get(String(roster._id)) ?? 0,
    })),
    meta: buildMeta({ page, limit, total }),
  });
});

/**
 * GET /attendance/rosters/me — your published planned shifts.
 *
 * Gated on recordOwn, not view, so seeing next week's nights never implies
 * you can see a colleague's.
 */
export const listOwnAssignments = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const from = startOfDay(query.from ?? mondayOf(new Date()));
  const to = query.to ? startOfDay(query.to) : sundayOf(from);
  to.setHours(23, 59, 59, 999);

  const published = await ShiftRoster.find({
    status: 'published',
    isActive: true,
  })
    .select('_id')
    .lean();

  const assignments = await ShiftAssignment.find({
    userId: req.user._id,
    isActive: true,
    rosterId: { $in: published.map((r) => r._id) },
    date: { $gte: from, $lte: to },
  })
    .populate({ path: 'rosterId', select: 'weekStart departmentId status' })
    .sort({ date: 1 })
    .lean();

  return sendResponse(res, { data: assignments, meta: { from, to } });
});

/** GET /attendance/rosters/:id */
export const getRoster = asyncHandler(async (req, res) => {
  const roster = await ShiftRoster.findById(req.params.id).populate(ROSTER_POPULATE);
  if (!roster) throw ApiError.notFound('Roster not found');
  return sendResponse(res, { data: await withAssignments(roster) });
});

// ----------------------------------------------------------- write path ----

/** POST /attendance/rosters */
export const createRoster = asyncHandler(async (req, res) => {
  const weekStart = mondayOf(req.body.weekStart);
  const departmentId = req.body.departmentId || null;

  if (departmentId) {
    const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
    if (!department) {
      throw ApiError.badRequest('The selected department does not exist or is inactive', {
        details: [{ field: 'departmentId', message: 'Invalid department' }],
      });
    }
  }

  const existing = await ShiftRoster.findOne({ weekStart, departmentId, isActive: true });
  if (existing) {
    throw ApiError.conflict('A roster for that week and department already exists', {
      code: 'ROSTER_EXISTS',
      details: [{ field: 'weekStart', message: 'Already drafted or published' }],
    });
  }

  const roster = await ShiftRoster.create({
    weekStart,
    departmentId,
    notes: req.body.notes ?? '',
    status: 'draft',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await roster.populate(ROSTER_POPULATE);
  return sendCreated(res, {
    message: 'Draft roster created',
    data: await withAssignments(roster),
  });
});

/** POST /attendance/rosters/:id/publish */
export const publishRoster = asyncHandler(async (req, res) => {
  const roster = await loadRoster(req.params.id);
  if (roster.status === 'published') {
    throw ApiError.conflict('This roster is already published', { code: 'ROSTER_PUBLISHED' });
  }

  const count = await ShiftAssignment.countDocuments({ rosterId: roster._id, isActive: true });
  if (count === 0) {
    throw ApiError.conflict('Assign at least one shift before publishing', {
      code: 'ROSTER_EMPTY',
    });
  }

  roster.status = 'published';
  roster.publishedAt = new Date();
  roster.publishedBy = req.user._id;
  roster.updatedBy = req.user._id;
  await roster.save();

  await roster.populate(ROSTER_POPULATE);
  return sendResponse(res, {
    message: 'Roster published — staff can now see their planned shifts',
    data: await withAssignments(roster),
  });
});

/** POST /attendance/rosters/:id/unpublish */
export const unpublishRoster = asyncHandler(async (req, res) => {
  const roster = await loadRoster(req.params.id);
  if (roster.status !== 'published') {
    throw ApiError.conflict('This roster is not published', { code: 'ROSTER_NOT_PUBLISHED' });
  }

  roster.status = 'draft';
  roster.publishedAt = null;
  roster.publishedBy = null;
  roster.updatedBy = req.user._id;
  await roster.save();

  await roster.populate(ROSTER_POPULATE);
  return sendResponse(res, {
    message: 'Roster unpublished — it is a draft again',
    data: await withAssignments(roster),
  });
});

/** DELETE /attendance/rosters/:id — draft only. */
export const deleteRoster = asyncHandler(async (req, res) => {
  const roster = await loadRoster(req.params.id);
  assertDraft(roster);

  await ShiftAssignment.updateMany(
    { rosterId: roster._id, isActive: true },
    softDeletePatch(req.user),
  );
  Object.assign(roster, softDeletePatch(req.user));
  await roster.save();

  return sendResponse(res, { message: 'Draft roster removed', data: { id: roster._id } });
});

// --------------------------------------------------------- assignments ----

async function assertAssignable(userId, date, roster, { ignoreAssignmentId } = {}) {
  if (!isDateInWeek(date, roster.weekStart)) {
    throw ApiError.badRequest('That date is not in this roster week', {
      details: [{ field: 'date', message: 'Must fall in the roster week' }],
    });
  }

  const user = await User.findOne({ _id: userId, isActive: true }).lean();
  if (!user) {
    throw ApiError.badRequest('That staff member does not exist or is inactive', {
      details: [{ field: 'userId', message: 'Invalid staff member' }],
    });
  }

  const clash = await ShiftAssignment.findOne({
    userId,
    date: startOfDay(date),
    isActive: true,
    ...(ignoreAssignmentId ? { _id: { $ne: ignoreAssignmentId } } : {}),
  }).populate({ path: 'rosterId', select: 'weekStart departmentId status' });

  if (clash && String(clash.rosterId?._id ?? clash.rosterId) !== String(roster._id)) {
    throw ApiError.conflict(
      'That person is already rostered on another week or department that day',
      {
        code: 'SHIFT_DOUBLE_BOOKED',
        details: [{ field: 'userId', message: 'Already assigned that day' }],
      },
    );
  }

  return { user, existing: clash && String(clash.rosterId) === String(roster._id) ? clash : null };
}

/** PUT /attendance/rosters/:id/assignments — replace the week's plan. */
export const replaceAssignments = asyncHandler(async (req, res) => {
  const roster = await loadRoster(req.params.id);
  assertDraft(roster);

  const incoming = req.body.assignments ?? [];
  for (const item of incoming) {
    await assertAssignable(item.userId, item.date, roster);
  }

  await ShiftAssignment.updateMany(
    { rosterId: roster._id, isActive: true },
    softDeletePatch(req.user),
  );

  if (incoming.length) {
    await ShiftAssignment.create(
      incoming.map((item) => ({
        rosterId: roster._id,
        userId: item.userId,
        date: startOfDay(item.date),
        shift: item.shift,
        notes: item.notes ?? '',
        createdBy: req.user._id,
        updatedBy: req.user._id,
      })),
    );
  }

  await roster.populate(ROSTER_POPULATE);
  return sendResponse(res, {
    message: `${incoming.length} assignment(s) saved`,
    data: await withAssignments(roster),
  });
});

/** POST /attendance/rosters/:id/assignments — set one cell. */
export const upsertAssignment = asyncHandler(async (req, res) => {
  const roster = await loadRoster(req.params.id);
  assertDraft(roster);

  const date = startOfDay(req.body.date);
  await assertAssignable(req.body.userId, date, roster);

  const existing = await ShiftAssignment.findOne({
    rosterId: roster._id,
    userId: req.body.userId,
    date,
  });

  let assignment;
  if (existing) {
    existing.shift = req.body.shift;
    if (req.body.notes !== undefined) existing.notes = req.body.notes;
    existing.isActive = true;
    existing.deletedAt = null;
    existing.deletedBy = null;
    existing.updatedBy = req.user._id;
    assignment = await existing.save();
  } else {
    assignment = await ShiftAssignment.create({
      rosterId: roster._id,
      userId: req.body.userId,
      date,
      shift: req.body.shift,
      notes: req.body.notes ?? '',
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  }

  await assignment.populate(ASSIGNMENT_POPULATE);
  return sendResponse(res, { message: 'Shift assigned', data: assignment });
});

/** DELETE /attendance/rosters/:id/assignments/:assignmentId */
export const removeAssignment = asyncHandler(async (req, res) => {
  const roster = await loadRoster(req.params.id);
  assertDraft(roster);

  const assignment = await ShiftAssignment.findOne({
    _id: req.params.assignmentId,
    rosterId: roster._id,
  });
  if (!assignment) throw ApiError.notFound('Assignment not found on this roster');

  Object.assign(assignment, softDeletePatch(req.user));
  await assignment.save();

  return sendResponse(res, { message: 'Shift cleared', data: { id: assignment._id } });
});
