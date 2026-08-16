import { Notification } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta } from '../utils/queryHelpers.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-createdAt',
  });
  const filter = { userId: req.user._id };
  if (query.unreadOnly) filter.readAt = null;
  if (query.type) filter.type = query.type;

  const [rows, total, unread] = await Promise.all([
    Notification.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.user._id, readAt: null }),
  ]);

  return sendResponse(res, {
    data: rows,
    meta: { ...buildMeta({ page, limit, total }), unread },
  });
});

export const unreadCount = asyncHandler(async (req, res) => {
  const unread = await Notification.countDocuments({ userId: req.user._id, readAt: null });
  return sendResponse(res, { data: { unread } });
});

export const markRead = asyncHandler(async (req, res) => {
  const row = await Notification.findOne({ _id: req.params.id, userId: req.user._id });
  if (!row) throw ApiError.notFound('Notification not found');
  if (!row.readAt) {
    row.readAt = new Date();
    await row.save();
  }
  return sendResponse(res, { message: 'Marked read', data: row });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { userId: req.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return sendResponse(res, {
    message: 'All notifications marked read',
    data: { updated: result.modifiedCount ?? 0 },
  });
});
