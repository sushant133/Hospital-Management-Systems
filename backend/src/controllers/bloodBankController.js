import { BloodUnit, BloodRequest, Patient, Encounter } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { notify } from '../services/notificationService.js';

const REQ_POP = [
  { path: 'patientId', select: 'mrn firstName lastName bloodGroup' },
  { path: 'encounterId', select: 'encounterNumber type status' },
  { path: 'requestedBy', select: 'firstName lastName role' },
];

export const listUnits = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'expiresAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.group ? { group: query.group } : null,
    query.component ? { component: query.component } : null,
    query.status ? { status: query.status } : null,
  );
  const [rows, total] = await Promise.all([
    BloodUnit.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    BloodUnit.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const registerUnit = asyncHandler(async (req, res) => {
  const row = await BloodUnit.create({
    ...req.body,
    status: 'available',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  return sendCreated(res, { message: `Bag ${row.bagNumber} registered`, data: row });
});

export const discardUnit = asyncHandler(async (req, res) => {
  const row = await BloodUnit.findById(req.params.id);
  if (!row) throw ApiError.notFound('Unit not found');
  if (row.status === 'issued') throw ApiError.conflict('Cannot discard an issued unit');
  row.status = 'discarded';
  row.notes = req.body.reason || row.notes;
  row.updatedBy = req.user._id;
  await row.save();
  return sendResponse(res, { message: 'Unit discarded', data: row });
});

export const listRequests = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.patientId ? { patientId: query.patientId } : null,
  );
  const [rows, total] = await Promise.all([
    BloodRequest.find(filter).populate(REQ_POP).sort(sort).skip(skip).limit(limit).lean(),
    BloodRequest.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const createRequest = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ _id: req.body.patientId, isActive: true }).lean();
  if (!patient) throw ApiError.badRequest('Invalid patient');
  const encounter = await Encounter.findOne({ _id: req.body.encounterId, isActive: true }).lean();
  if (!encounter) throw ApiError.badRequest('Invalid visit');
  const row = await BloodRequest.create({
    ...req.body,
    requestedBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await row.populate(REQ_POP);
  return sendCreated(res, { message: `Request ${row.requestNumber} raised`, data: row });
});

export const crossmatch = asyncHandler(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Request not found');
  if (!['requested', 'crossmatched'].includes(request.status)) {
    throw ApiError.conflict('Request cannot be crossmatched');
  }
  const needed = request.unitsRequested - request.reservedUnitIds.length;
  const units = await BloodUnit.find({
    _id: { $in: req.body.unitIds ?? [] },
    status: 'available',
    group: request.group,
    component: request.component,
    isActive: true,
  });
  if (units.length === 0) throw ApiError.badRequest('No matching available units in the list');
  for (const unit of units) {
    unit.status = 'reserved';
    unit.reservedForRequestId = request._id;
    unit.updatedBy = req.user._id;
    await unit.save();
    request.reservedUnitIds.push(unit._id);
  }
  request.status = 'crossmatched';
  request.crossmatchNote = req.body.note || request.crossmatchNote;
  request.updatedBy = req.user._id;
  await request.save();
  if (needed > units.length) {
    /* reserved fewer than asked — still a valid partial crossmatch */
  }
  await request.populate(REQ_POP);
  return sendResponse(res, { message: `Reserved ${units.length} unit(s)`, data: request });
});

export const issueUnits = asyncHandler(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Request not found');
  if (!['crossmatched', 'issued'].includes(request.status)) {
    throw ApiError.conflict('Crossmatch before issuing');
  }
  const ids = request.reservedUnitIds;
  const units = await BloodUnit.find({ _id: { $in: ids }, status: 'reserved' });
  for (const unit of units) {
    unit.status = 'issued';
    unit.issuedToPatientId = request.patientId;
    unit.updatedBy = req.user._id;
    await unit.save();
    request.issuedUnitIds.push(unit._id);
  }
  request.status = request.issuedUnitIds.length >= request.unitsRequested ? 'fulfilled' : 'issued';
  request.updatedBy = req.user._id;
  await request.save();
  if (request.requestedBy) {
    void notify({
      userId: request.requestedBy,
      type: 'blood',
      title: `Blood issued for ${request.requestNumber}`,
      body: `${units.length} ${request.component.toUpperCase()} ${request.group}`,
      patientId: request.patientId,
      resourceType: 'BloodRequest',
      resourceId: request._id,
    });
  }
  await request.populate(REQ_POP);
  return sendResponse(res, { message: `Issued ${units.length} unit(s)`, data: request });
});
