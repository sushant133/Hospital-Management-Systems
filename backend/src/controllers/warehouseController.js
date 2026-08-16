import { DailySnapshot } from '../models/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse from '../utils/sendResponse.js';
import { computeDailySnapshot } from '../services/warehouseService.js';

export const listSnapshots = asyncHandler(async (req, res) => {
  const limit = Math.min(90, Number(req.query.limit) || 30);
  const rows = await DailySnapshot.find({}).sort({ date: -1 }).limit(limit).lean();
  return sendResponse(res, { data: rows });
});

export const rebuildToday = asyncHandler(async (req, res) => {
  const row = await computeDailySnapshot(req.body.date ? new Date(req.body.date) : new Date());
  return sendResponse(res, { message: 'Snapshot rebuilt', data: row });
});
