import { LabTest, Department, LabOrder } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import asyncHandler from '../../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../../utils/sendResponse.js';
import { getQuery } from '../../middleware/validate.js';
import {
  buildPagination,
  buildMeta,
  activeScope,
  searchFilter,
  andFilters,
  softDeletePatch,
} from '../../utils/queryHelpers.js';

const POPULATE = { path: 'departmentId', select: 'code name' };

/** Analyte codes must be unique within a test — duplicates break result entry. */
function assertUniqueAnalyteCodes(analytes = []) {
  const seen = new Set();
  for (const analyte of analytes) {
    const key = analyte.code.toUpperCase();
    if (seen.has(key)) {
      throw ApiError.validation('Analyte codes must be unique within a test', [
        { field: 'analytes', message: `Duplicate analyte code "${analyte.code}"` },
      ]);
    }
    seen.add(key);
  }
}

/** GET /lab/tests */
export const listLabTests = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || 'name' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.departmentId ? { departmentId: query.departmentId } : null,
    query.category ? { category: query.category } : null,
    query.specimen ? { specimen: query.specimen } : null,
    searchFilter(query.search, ['name', 'code', 'category']),
  );

  const [tests, total] = await Promise.all([
    LabTest.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    LabTest.countDocuments(filter),
  ]);

  return sendResponse(res, { data: tests, meta: buildMeta({ page, limit, total }) });
});

/** GET /lab/tests/:id */
export const getLabTest = asyncHandler(async (req, res) => {
  const test = await LabTest.findById(req.params.id).populate(POPULATE);
  if (!test) throw ApiError.notFound('Lab test not found');
  return sendResponse(res, { data: test });
});

/** POST /lab/tests — admin only. */
export const createLabTest = asyncHandler(async (req, res) => {
  const { departmentId, analytes, ...rest } = req.body;

  assertUniqueAnalyteCodes(analytes);

  const existing = await LabTest.findOne({ code: rest.code });
  if (existing) {
    throw ApiError.conflict('A lab test with this code already exists', {
      details: [{ field: 'code', message: 'Already in use' }],
    });
  }

  await assertDepartmentExists(departmentId);

  const test = await LabTest.create({
    ...rest,
    departmentId,
    analytes,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await test.populate(POPULATE);
  return sendCreated(res, { message: 'Lab test created', data: test });
});

/**
 * PATCH /lab/tests/:id — admin only.
 *
 * Editing price or analytes does NOT retro-affect existing orders or results:
 * orders snapshot the price, results snapshot the reference range.
 */
export const updateLabTest = asyncHandler(async (req, res) => {
  const test = await LabTest.findById(req.params.id);
  if (!test) throw ApiError.notFound('Lab test not found');

  const { code, departmentId, analytes, ...rest } = req.body;

  if (analytes) assertUniqueAnalyteCodes(analytes);

  if (code && code !== test.code) {
    const clash = await LabTest.findOne({ code, _id: { $ne: test._id } });
    if (clash) {
      throw ApiError.conflict('A lab test with this code already exists', {
        details: [{ field: 'code', message: 'Already in use' }],
      });
    }
    test.code = code;
  }

  if (departmentId) {
    await assertDepartmentExists(departmentId);
    test.departmentId = departmentId;
  }

  if (analytes) test.analytes = analytes;

  Object.assign(test, rest);
  test.updatedBy = req.user._id;
  await test.save();

  await test.populate(POPULATE);
  return sendResponse(res, { message: 'Lab test updated', data: test });
});

/** DELETE /lab/tests/:id — soft delete, refused while pending orders reference it. */
export const deleteLabTest = asyncHandler(async (req, res) => {
  const test = await LabTest.findById(req.params.id);
  if (!test) throw ApiError.notFound('Lab test not found');

  const pending = await LabOrder.countDocuments({
    'tests.labTestId': test._id,
    status: { $in: ['ordered', 'collected', 'in-progress'] },
    isActive: true,
  });

  if (pending > 0) {
    throw ApiError.conflict(
      `Cannot retire a test with ${pending} order(s) still in progress. Complete or cancel them first.`,
      { code: 'LAB_TEST_HAS_PENDING_ORDERS' },
    );
  }

  Object.assign(test, softDeletePatch(req.user));
  await test.save();

  return sendResponse(res, { message: 'Lab test retired', data: { id: test._id } });
});

/** PATCH /lab/tests/:id/restore — admin only. */
export const restoreLabTest = asyncHandler(async (req, res) => {
  const test = await LabTest.findById(req.params.id);
  if (!test) throw ApiError.notFound('Lab test not found');

  await test.restore(req.user);
  return sendResponse(res, { message: 'Lab test restored', data: test });
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
