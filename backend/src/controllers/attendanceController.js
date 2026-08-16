import { Attendance, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { attendanceSummary, periodBounds } from '../services/payrollService.js';

const POPULATE = [
  { path: 'userId', select: 'firstName lastName role departmentId' },
  { path: 'approvedBy', select: 'firstName lastName' },
];

/** Local midnight, so a day has exactly one row. */
function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Attendance — the record that drives pay.
 *
 * Clocking yourself in needs no permission beyond `attendance.recordOwn`, which
 * every role holds. Recording or amending *someone else's* attendance is
 * admin-only, because it is the input to what they are paid.
 */

/** GET /attendance */
export const listAttendance = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-date' });

  const dateRange = {};
  if (query.from) dateRange.$gte = startOfDay(query.from);
  if (query.to) dateRange.$lte = new Date(new Date(query.to).setHours(23, 59, 59, 999));

  const filter = andFilters(
    activeScope(query, req.user),
    query.userId ? { userId: query.userId } : null,
    query.status ? { status: query.status } : null,
    query.unapprovedOnly ? { approvedBy: null } : null,
    Object.keys(dateRange).length ? { date: dateRange } : null,
  );

  const [records, total] = await Promise.all([
    Attendance.find(filter).populate(POPULATE).sort({ date: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Attendance.countDocuments(filter),
  ]);

  return sendResponse(res, { data: records, meta: buildMeta({ page, limit, total }) });
});

/**
 * GET /attendance/me — your own record.
 *
 * Deliberately separate from the list above: reading your own attendance needs
 * no grant at all, so it must not go through a route gated on seeing everyone's.
 */
export const listOwnAttendance = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const period = query.period ?? new Date().toISOString().slice(0, 7);
  const { start, end } = periodBounds(period);

  const records = await Attendance.find({
    userId: req.user._id,
    isActive: true,
    date: { $gte: start, $lte: end },
  })
    .sort({ date: -1 })
    .lean({ virtuals: true });

  const summary = await attendanceSummary({ userId: req.user._id, period });

  return sendResponse(res, { data: records, meta: { period, summary } });
});

/**
 * POST /attendance/clock-in — start a shift.
 *
 * One row per person per day, so clocking in twice is refused rather than
 * silently creating a second day's pay.
 */
export const clockIn = asyncHandler(async (req, res) => {
  const today = startOfDay(req.body.date ?? new Date());

  const existing = await Attendance.findOne({ userId: req.user._id, date: today });
  if (existing && existing.checkInAt) {
    throw ApiError.conflict('You have already clocked in today', {
      code: 'ALREADY_CLOCKED_IN',
      details: { checkInAt: existing.checkInAt },
    });
  }

  const record =
    existing ??
    new Attendance({
      userId: req.user._id,
      date: today,
      createdBy: req.user._id,
    });

  record.checkInAt = req.body.at ?? new Date();
  record.shift = req.body.shift ?? record.shift;
  record.status = 'present';
  record.updatedBy = req.user._id;
  await record.save();

  await record.populate(POPULATE);
  return sendCreated(res, { message: 'Clocked in', data: record });
});

/** POST /attendance/clock-out — end the shift, deriving hours and overtime. */
export const clockOut = asyncHandler(async (req, res) => {
  const today = startOfDay(req.body.date ?? new Date());

  const record = await Attendance.findOne({ userId: req.user._id, date: today });
  if (!record || !record.checkInAt) {
    throw ApiError.conflict('You have not clocked in today', { code: 'NOT_CLOCKED_IN' });
  }
  if (record.checkOutAt) {
    throw ApiError.conflict('You have already clocked out today', {
      code: 'ALREADY_CLOCKED_OUT',
      details: { checkOutAt: record.checkOutAt },
    });
  }

  record.checkOutAt = req.body.at ?? new Date();
  record.updatedBy = req.user._id;
  await record.save();

  await record.populate(POPULATE);
  return sendResponse(res, {
    message: `Clocked out — ${record.hoursWorked} hour(s)${
      record.overtimeHours > 0 ? `, ${record.overtimeHours} overtime` : ''
    }`,
    data: record,
  });
});

/**
 * POST /attendance — record or correct someone else's day.
 *
 * Admin-only. Marking a colleague absent changes what they are paid, so it sits
 * behind `attendance.create` rather than the self-service grant.
 */
export const upsertAttendance = asyncHandler(async (req, res) => {
  const staff = await User.exists({ _id: req.body.userId, isActive: true });
  if (!staff) {
    throw ApiError.badRequest('That staff member does not exist', {
      details: [{ field: 'userId', message: 'Invalid staff member' }],
    });
  }

  const date = startOfDay(req.body.date);

  const record =
    (await Attendance.findOne({ userId: req.body.userId, date })) ??
    new Attendance({ userId: req.body.userId, date, createdBy: req.user._id });

  record.status = req.body.status;
  record.shift = req.body.shift ?? record.shift;
  record.checkInAt = req.body.checkInAt ?? record.checkInAt;
  record.checkOutAt = req.body.checkOutAt ?? record.checkOutAt;
  record.notes = req.body.notes ?? record.notes;

  // A day with no times worked cannot carry hours.
  if (['absent', 'leave'].includes(record.status)) {
    record.checkInAt = null;
    record.checkOutAt = null;
    record.hoursWorked = 0;
    record.overtimeHours = 0;
  }

  record.updatedBy = req.user._id;
  await record.save();

  await record.populate(POPULATE);
  return sendResponse(res, { message: 'Attendance recorded', data: record });
});

/**
 * POST /attendance/:id/approve — a supervisor confirms the record.
 *
 * Once any record in a period is approved, payroll counts only approved ones —
 * see `attendanceSummary`.
 */
export const approveAttendance = asyncHandler(async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound('Attendance record not found');

  if (String(record.userId) === String(req.user._id)) {
    throw ApiError.conflict('You cannot approve your own attendance', { code: 'SELF_APPROVAL' });
  }

  record.approvedBy = req.user._id;
  record.approvedAt = new Date();
  record.updatedBy = req.user._id;
  await record.save();

  await record.populate(POPULATE);
  return sendResponse(res, { message: 'Attendance approved', data: record });
});

/** GET /attendance/summary — per-person totals over a period. */
export const getSummary = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const period = query.period ?? new Date().toISOString().slice(0, 7);

  const staff = await User.find(
    andFilters({ isActive: true }, query.departmentId ? { departmentId: query.departmentId } : null),
  )
    .select('firstName lastName role departmentId')
    .lean();

  const rows = [];
  for (const member of staff) {
    const summary = await attendanceSummary({ userId: member._id, period });
    rows.push({
      userId: member._id,
      name: `${member.firstName} ${member.lastName}`.trim(),
      role: member.role,
      ...summary,
    });
  }

  return sendResponse(res, {
    data: rows.sort((a, b) => b.payableDays - a.payableDays),
    meta: {
      period,
      staffCount: rows.length,
      totalPayableDays: Math.round(rows.reduce((sum, r) => sum + r.payableDays, 0) * 100) / 100,
      totalOvertimeHours: Math.round(rows.reduce((sum, r) => sum + r.overtimeHours, 0) * 100) / 100,
    },
  });
});
