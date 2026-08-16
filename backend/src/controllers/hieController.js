import { Consent, Patient } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { buildEncounterBundle } from '../services/fhirService.js';

export const listConsents = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-grantedAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.status ? { status: query.status } : null,
  );
  const [rows, total] = await Promise.all([
    Consent.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName abhaId' })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Consent.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const grantConsent = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ _id: req.body.patientId, isActive: true }).lean();
  if (!patient) throw ApiError.badRequest('Invalid patient');
  const row = await Consent.create({
    ...req.body,
    grantedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: 'Consent recorded', data: row });
});

export const revokeConsent = asyncHandler(async (req, res) => {
  const row = await Consent.findById(req.params.id);
  if (!row) throw ApiError.notFound('Consent not found');
  row.status = 'revoked';
  row.revokedAt = new Date();
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'Consent revoked', data: row });
});

export const exportBundle = asyncHandler(async (req, res) => {
  const encounterId = req.params.encounterId;
  const patientId = req.body.patientId || req.query.patientId;
  const consent = await Consent.findOne({
    patientId,
    status: 'active',
    purpose: { $in: ['hie', 'referral', 'treatment'] },
    isActive: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });
  if (!consent) {
    throw ApiError.forbidden('No active HIE/referral consent for this patient', { code: 'NO_CONSENT' });
  }
  const bundle = await buildEncounterBundle(encounterId);
  if (!bundle) throw ApiError.notFound('Encounter not found');
  return sendResponse(res, { message: 'Bundle assembled', data: { consentId: consent._id, bundle } });
});
