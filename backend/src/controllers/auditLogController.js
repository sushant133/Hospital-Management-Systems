import AuditLog from '../models/AuditLog.js';
import Patient from '../models/Patient.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, andFilters } from '../utils/queryHelpers.js';

/**
 * Audit entries are never soft-deleted, so `activeScope` does not apply here —
 * the whole point of the collection is that nothing disappears from it.
 */
function buildAuditFilter(query) {
  const range = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lt = query.to;

  return andFilters(
    query.userId ? { userId: query.userId } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.resourceId ? { resourceId: query.resourceId } : null,
    query.resourceType ? { resourceType: query.resourceType } : null,
    query.module ? { module: query.module } : null,
    query.action ? { action: query.action } : null,
    query.outcome ? { outcome: query.outcome } : null,
    Object.keys(range).length > 0 ? { createdAt: range } : null,
  );
}

/** GET /audit-logs — newest first. */
export const listAuditLogs = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-createdAt' });
  const filter = buildAuditFilter(query);

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .populate({ path: 'userId', select: 'employeeId firstName lastName role' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return sendResponse(res, { data: entries, meta: buildMeta({ page, limit, total }) });
});

/**
 * GET /audit-logs/patient/:patientId
 * "Who has touched this patient's record?" — the question a compliance officer
 * actually asks. Served off the { patientId, createdAt } index.
 */
export const listPatientAuditTrail = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.patientId).select('mrn firstName lastName').lean();
  if (!patient) throw ApiError.notFound('Patient not found');

  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-createdAt' });
  const filter = { patientId: req.params.patientId };

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .populate({ path: 'userId', select: 'employeeId firstName lastName role' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return sendResponse(res, {
    data: entries,
    meta: { ...buildMeta({ page, limit, total }), patient },
  });
});
