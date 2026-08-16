import { SmsMessage } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, andFilters, searchFilter } from '../utils/queryHelpers.js';
import { queue } from '../services/smsService.js';
import { SMS_TEMPLATES } from '../models/SmsMessage.js';
import config from '../config/env.js';
import { roundPaisa } from '../utils/nepal.js';

export const listMessages = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  let dateRange = null;
  if (query.from || query.to) {
    dateRange = { createdAt: {} };
    if (query.from) dateRange.createdAt.$gte = query.from;
    if (query.to) dateRange.createdAt.$lte = query.to;
  }

  const filter = andFilters(
    query.status ? { status: query.status } : null,
    query.template ? { template: query.template } : null,
    query.patientId ? { patientId: query.patientId } : null,
    searchFilter(query.search, ['to', 'body']),
    dateRange,
  );

  const [rows, total] = await Promise.all([
    SmsMessage.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    SmsMessage.countDocuments(filter),
  ]);

  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

/** The templates the UI can offer, so it never invents a name the server rejects. */
export const listTemplates = asyncHandler(async (_req, res) =>
  sendResponse(res, {
    data: Object.entries(SMS_TEMPLATES).map(([key, value]) => ({ key, template: value })),
    meta: { enabled: config.sms.enabled, provider: config.sms.provider },
  }),
);

/**
 * Send an ad-hoc message.
 *
 * Queued, never sent inline — the queue owns retry, delivery tracking and the
 * cost trail, and a request that waited on a flaky gateway would hang the UI.
 */
export const send = asyncHandler(async (req, res) => {
  const message = await queue({
    ...req.body,
    userId: req.user._id,
  });

  if (!message) {
    throw ApiError.badRequest(
      'Nothing was queued — the number is not a usable Nepali mobile, or an identical ' +
        'message is already waiting to go.',
      { code: 'SMS_NOT_QUEUED' },
    );
  }

  return sendCreated(res, {
    message: config.sms.enabled
      ? 'Message queued'
      : 'Message recorded but SMS is disabled in this environment.',
    data: message,
  });
});

/**
 * Push a failed message back into the queue.
 *
 * Resets the attempt counter deliberately: the operator has looked at why it
 * failed, and a retry that immediately re-exhausts the old count is useless.
 */
export const resend = asyncHandler(async (req, res) => {
  const message = await SmsMessage.findById(req.params.id);
  if (!message) throw ApiError.notFound('Message not found');

  if (['sent', 'delivered'].includes(message.status)) {
    throw ApiError.conflict(
      'This message was already delivered. Sending it again would reach the patient twice.',
      { code: 'ALREADY_DELIVERED' },
    );
  }

  message.status = 'queued';
  message.attempts = 0;
  message.failureReason = '';
  message.sendAfter = new Date();
  // The dedupe key has served its purpose; clearing it lets a deliberate resend
  // through the unique index that would otherwise block it.
  message.dedupeKey = '';
  await message.save();

  return sendResponse(res, { message: 'Message re-queued', data: message });
});

/**
 * What SMS is costing.
 *
 * Worth its own endpoint because of the encoding trap: a Devanagari message is
 * UCS-2, where a segment is 70 characters rather than 160, so the same reminder
 * costs roughly three times as much in Nepali as in English. A reminder
 * campaign nobody is watching is a real line item.
 */
export const usageReport = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86400000);
  const to = query.to ? new Date(query.to) : new Date();

  const rows = await SmsMessage.aggregate([
    { $match: { createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { template: '$template', encoding: '$encoding' },
        messages: { $sum: 1 },
        segments: { $sum: '$segments' },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      },
    },
    { $sort: { segments: -1 } },
  ]);

  const totals = rows.reduce(
    (acc, row) => ({
      messages: acc.messages + row.messages,
      segments: acc.segments + row.segments,
      delivered: acc.delivered + row.delivered,
      failed: acc.failed + row.failed,
    }),
    { messages: 0, segments: 0, delivered: 0, failed: 0 },
  );

  return sendResponse(res, {
    data: {
      period: { from, to },
      byTemplate: rows.map((row) => ({
        template: row._id.template,
        encoding: row._id.encoding,
        messages: row.messages,
        segments: row.segments,
        delivered: row.delivered,
        failed: row.failed,
        estimatedCost: roundPaisa(row.segments * config.sms.costPerSegment),
      })),
      totals: {
        ...totals,
        estimatedCost: roundPaisa(totals.segments * config.sms.costPerSegment),
        deliveryRate: totals.messages > 0 ? Math.round((totals.delivered / totals.messages) * 100) : null,
      },
    },
    meta: {
      costPerSegment: config.sms.costPerSegment,
      note: 'A Devanagari message is UCS-2: 70 characters per segment, not 160.',
    },
  });
});
