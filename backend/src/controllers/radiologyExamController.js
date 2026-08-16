import { RadiologyExam, Department, RadiologyOrder } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  searchFilter,
  andFilters,
  softDeletePatch,
} from '../utils/queryHelpers.js';

const POPULATE = { path: 'departmentId', select: 'code name' };

/** GET /radiology/exams */
export const listRadiologyExams = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.modality ? { modality: query.modality } : null,
    query.bodyPart ? { bodyPart: new RegExp(query.bodyPart, 'i') } : null,
    searchFilter(query.search, ['name', 'code', 'bodyPart']),
  );

  const [exams, total] = await Promise.all([
    RadiologyExam.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    RadiologyExam.countDocuments(filter),
  ]);

  return sendResponse(res, { data: exams, meta: buildMeta({ page, limit, total }) });
});

/** GET /radiology/exams/:id */
export const getRadiologyExam = asyncHandler(async (req, res) => {
  const exam = await RadiologyExam.findById(req.params.id).populate(POPULATE);
  if (!exam) throw ApiError.notFound('Radiology exam not found');
  return sendResponse(res, { data: exam });
});

/** POST /radiology/exams — admin only. */
export const createRadiologyExam = asyncHandler(async (req, res) => {
  const { departmentId, ...rest } = req.body;

  const existing = await RadiologyExam.findOne({ code: rest.code });
  if (existing) {
    throw ApiError.conflict('An exam with this code already exists', {
      details: [{ field: 'code', message: 'Already in use' }],
    });
  }

  await assertDepartmentExists(departmentId);

  const exam = await RadiologyExam.create({
    ...rest,
    departmentId,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await exam.populate(POPULATE);
  return sendCreated(res, { message: 'Exam added to the catalogue', data: exam });
});

/**
 * PATCH /radiology/exams/:id — admin only.
 *
 * Editing price or duration does NOT retro-affect existing orders: they
 * snapshot those fields at request time.
 */
export const updateRadiologyExam = asyncHandler(async (req, res) => {
  const exam = await RadiologyExam.findById(req.params.id);
  if (!exam) throw ApiError.notFound('Radiology exam not found');

  const { code, departmentId, ...rest } = req.body;

  if (code && code !== exam.code) {
    const clash = await RadiologyExam.findOne({ code, _id: { $ne: exam._id } });
    if (clash) {
      throw ApiError.conflict('An exam with this code already exists', {
        details: [{ field: 'code', message: 'Already in use' }],
      });
    }
    exam.code = code;
  }

  if (departmentId) {
    await assertDepartmentExists(departmentId);
    exam.departmentId = departmentId;
  }

  Object.assign(exam, rest);
  exam.updatedBy = req.user._id;
  await exam.save();

  await exam.populate(POPULATE);
  return sendResponse(res, { message: 'Exam updated', data: exam });
});

/** DELETE /radiology/exams/:id — soft delete, refused while pending orders reference it. */
export const deleteRadiologyExam = asyncHandler(async (req, res) => {
  const exam = await RadiologyExam.findById(req.params.id);
  if (!exam) throw ApiError.notFound('Radiology exam not found');

  const pending = await RadiologyOrder.countDocuments({
    examId: exam._id,
    status: { $in: ['ordered', 'scheduled', 'in-progress'] },
    isActive: true,
  });

  if (pending > 0) {
    throw ApiError.conflict(
      `Cannot retire an exam with ${pending} order(s) still in progress. Complete or cancel them first.`,
      { code: 'RADIOLOGY_EXAM_HAS_PENDING_ORDERS' },
    );
  }

  Object.assign(exam, softDeletePatch(req.user));
  await exam.save();

  return sendResponse(res, { message: 'Exam retired', data: { id: exam._id } });
});

/** PATCH /radiology/exams/:id/restore — admin only. */
export const restoreRadiologyExam = asyncHandler(async (req, res) => {
  const exam = await RadiologyExam.findById(req.params.id);
  if (!exam) throw ApiError.notFound('Radiology exam not found');

  await exam.restore(req.user);
  return sendResponse(res, { message: 'Exam restored', data: exam });
});

async function assertDepartmentExists(departmentId) {
  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
  if (!department) {
    throw ApiError.badRequest('The selected department does not exist or is inactive', {
      details: [{ field: 'departmentId', message: 'Invalid department' }],
    });
  }
  return department;
}
