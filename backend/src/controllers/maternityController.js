import { MaternityCase, AncVisit, Immunization, Patient } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { notify } from '../services/notificationService.js';

const CASE_POP = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender bloodGroup' },
];

export const listCases = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-edd' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.patientId ? { patientId: query.patientId } : null,
    query.highRisk ? { highRisk: true } : null,
  );
  const [rows, total] = await Promise.all([
    MaternityCase.find(filter).populate(CASE_POP).sort(sort).skip(skip).limit(limit),
    MaternityCase.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getCase = asyncHandler(async (req, res) => {
  const row = await MaternityCase.findById(req.params.id).populate(CASE_POP);
  if (!row) throw ApiError.notFound('Maternity case not found');
  const visits = await AncVisit.find({ caseId: row._id, isActive: true })
    .populate({ path: 'seenBy', select: 'firstName lastName' })
    .sort({ visitNumber: 1 })
    .lean();
  return sendResponse(res, { data: { ...row.toJSON(), visits } });
});

export const createCase = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ _id: req.body.patientId, isActive: true }).lean();
  if (!patient) throw ApiError.badRequest('Invalid patient');
  const open = await MaternityCase.findOne({ patientId: patient._id, status: 'antenatal', isActive: true });
  if (open) throw ApiError.conflict(`Open case ${open.caseNumber} already exists`, { code: 'ANC_OPEN' });

  const lmp = new Date(req.body.lmp);
  const edd = req.body.edd ? new Date(req.body.edd) : new Date(lmp.getTime() + 280 * 86400000);
  const row = await MaternityCase.create({
    ...req.body,
    lmp,
    edd,
    bloodGroup: req.body.bloodGroup || patient.bloodGroup || '',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  if (row.highRisk) {
    void notify({
      userId: req.user._id,
      type: 'maternity',
      title: `High-risk ANC ${row.caseNumber}`,
      body: (row.riskReasons || []).join('; '),
      patientId: patient._id,
      resourceType: 'MaternityCase',
      resourceId: row._id,
    });
  }
  await row.populate(CASE_POP);
  return sendCreated(res, { message: `Case ${row.caseNumber} opened`, data: row });
});

export const updateCase = asyncHandler(async (req, res) => {
  const row = await MaternityCase.findById(req.params.id);
  if (!row) throw ApiError.notFound('Maternity case not found');
  Object.assign(row, req.body);
  row.updatedBy = req.user._id;
  await row.save();
  await row.populate(CASE_POP);
  return sendResponse(res, { message: 'Case updated', data: row });
});

export const addVisit = asyncHandler(async (req, res) => {
  const maternity = await MaternityCase.findById(req.params.id);
  if (!maternity) throw ApiError.notFound('Maternity case not found');
  if (maternity.status !== 'antenatal') throw ApiError.conflict('Case is not antenatal');
  const last = await AncVisit.findOne({ caseId: maternity._id }).sort({ visitNumber: -1 }).select('visitNumber').lean();
  const visit = await AncVisit.create({
    ...req.body,
    caseId: maternity._id,
    patientId: maternity.patientId,
    visitNumber: (last?.visitNumber ?? 0) + 1,
    seenBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  if (visit.systolicBp >= 140 || visit.haemoglobin < 7) {
    maternity.highRisk = true;
    if (visit.systolicBp >= 140) maternity.riskReasons = [...new Set([...(maternity.riskReasons ?? []), 'hypertension'])];
    if (visit.haemoglobin < 7) maternity.riskReasons = [...new Set([...(maternity.riskReasons ?? []), 'severe anaemia'])];
    await maternity.save();
  }
  return sendCreated(res, { message: `ANC visit ${visit.visitNumber} recorded`, data: visit });
});

export const listImmunizations = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-givenAt' });
  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.vaccineCode ? { vaccineCode: query.vaccineCode } : null,
  );
  const [rows, total] = await Promise.all([
    Immunization.find(filter)
      .populate({ path: 'patientId', select: 'mrn firstName lastName dateOfBirth' })
      .populate({ path: 'givenBy', select: 'firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Immunization.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const recordImmunization = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ _id: req.body.patientId, isActive: true }).lean();
  if (!patient) throw ApiError.badRequest('Invalid patient');
  const row = await Immunization.create({
    ...req.body,
    givenBy: req.user._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await row.populate([
    { path: 'patientId', select: 'mrn firstName lastName' },
    { path: 'givenBy', select: 'firstName lastName' },
  ]);
  return sendCreated(res, { message: `${row.vaccineName} recorded`, data: row });
});
