import { Remittance, Claim, InsuranceProvider } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { adjustCoverageUsed } from '../services/insuranceService.js';

export const listRemittances = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-receivedAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.providerId ? { providerId: query.providerId } : null,
  );
  const [rows, total] = await Promise.all([
    Remittance.find(filter)
      .populate({ path: 'providerId', select: 'code name kind' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Remittance.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createRemittance = asyncHandler(async (req, res) => {
  const provider = await InsuranceProvider.findById(req.body.providerId).lean();
  if (!provider) throw ApiError.badRequest('Invalid provider');
  const row = await Remittance.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Remittance ${row.remittanceNumber} captured`, data: row });
});

export const postRemittance = asyncHandler(async (req, res) => {
  const row = await Remittance.findById(req.params.id);
  if (!row) throw ApiError.notFound('Remittance not found');
  if (row.posted) throw ApiError.conflict('Already posted');

  for (const line of row.lines) {
    const claim = await Claim.findById(line.claimId);
    if (!claim) continue;
    const paid = line.paidAmount ?? 0;
    claim.approvedAmount = (claim.approvedAmount ?? 0) + paid;
    if (line.deniedAmount > 0 && paid === 0) {
      claim.status = 'rejected';
    } else if (paid > 0 && paid < (claim.claimedAmount ?? 0)) {
      claim.status = 'partially-approved';
    } else if (paid > 0) {
      claim.status = 'settled';
      claim.settledAt = new Date();
    }
    claim.history.push({
      status: claim.status,
      at: new Date(),
      by: req.user._id,
      amount: paid,
      notes: line.denialCode || line.note || 'ERA posted',
    });
    claim.updatedBy = req.user._id;
    await claim.save();
    if (paid > 0 && claim.policyId) {
      await adjustCoverageUsed({ policyId: claim.policyId, delta: paid, user: req.user }).catch(() => {});
    }
  }

  row.posted = true;
  row.postedAt = new Date();
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'Remittance posted to claims', data: row });
});

export const exportClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id)
    .populate({ path: 'patientId', select: 'mrn firstName lastName abhaId' })
    .populate({ path: 'providerId', select: 'code name kind' })
    .populate({ path: 'policyId', select: 'policyNumber planName' })
    .populate({ path: 'invoiceId', select: 'invoiceNumber total' })
    .lean();
  if (!claim) throw ApiError.notFound('Claim not found');
  return sendResponse(res, {
    data: {
      format: 'hms-claim-v1',
      exportedAt: new Date().toISOString(),
      claim,
    },
  });
});
