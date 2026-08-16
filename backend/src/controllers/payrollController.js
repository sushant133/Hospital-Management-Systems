import {
  PayrollRun,
  Payslip,
  SalaryStructure,
  User,
  PAYROLL_TRANSITIONS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters, softDeletePatch } from '../utils/queryHelpers.js';
import { buildRun, assertEditable, weekdaysIn } from '../services/payrollService.js';

const RUN_POPULATE = [
  { path: 'builtBy', select: 'firstName lastName' },
  { path: 'approvedBy', select: 'firstName lastName' },
];

const PAYSLIP_POPULATE = [
  { path: 'userId', select: 'firstName lastName role employeeId' },
  { path: 'payrollRunId', select: 'period status approvedAt' },
];

function assertTransition(from, to) {
  const allowed = PAYROLL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `Cannot move a payroll run from "${from}" to "${to}".` +
        (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This run is final.'),
      { code: 'INVALID_STATUS_TRANSITION' },
    );
  }
}

// ------------------------------------------------------- salary structures ----

/** GET /payroll/structures */
export const listStructures = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-effectiveFrom' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.userId ? { userId: query.userId } : null,
    query.currentOnly ? { effectiveTo: null } : null,
  );

  const [structures, total] = await Promise.all([
    SalaryStructure.find(filter)
      .populate({ path: 'userId', select: 'firstName lastName role employeeId' })
      .sort({ effectiveFrom: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SalaryStructure.countDocuments(filter),
  ]);

  return sendResponse(res, { data: structures, meta: buildMeta({ page, limit, total }) });
});

/**
 * POST /payroll/structures — set someone's pay.
 *
 * A rise creates a NEW structure and closes the previous one, rather than
 * editing it: a payslip from last year must still be explicable, and that means
 * the structure it was computed from has to survive.
 */
export const createStructure = asyncHandler(async (req, res) => {
  const staff = await User.exists({ _id: req.body.userId, isActive: true });
  if (!staff) {
    throw ApiError.badRequest('That staff member does not exist', {
      details: [{ field: 'userId', message: 'Invalid staff member' }],
    });
  }

  const effectiveFrom = new Date(req.body.effectiveFrom);

  // Close whatever is currently open, the day before the new one starts.
  const current = await SalaryStructure.findOne({
    userId: req.body.userId,
    isActive: true,
    effectiveTo: null,
  }).sort({ effectiveFrom: -1 });

  if (current) {
    if (current.effectiveFrom >= effectiveFrom) {
      throw ApiError.conflict(
        'A structure already exists from that date or later. Back-dating pay changes is not supported.',
        { code: 'STRUCTURE_OVERLAP', details: { existingFrom: current.effectiveFrom } },
      );
    }
    const closeAt = new Date(effectiveFrom);
    closeAt.setDate(closeAt.getDate() - 1);
    current.effectiveTo = closeAt;
    current.updatedBy = req.user._id;
    await current.save();
  }

  const structure = await SalaryStructure.create({
    ...req.body,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await structure.populate({ path: 'userId', select: 'firstName lastName role' });
  return sendCreated(res, {
    message: current ? 'Salary updated — the previous structure was closed' : 'Salary structure set',
    data: structure,
  });
});

// -------------------------------------------------------------- runs ----

/** GET /payroll/runs */
export const listRuns = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-period' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
  );

  const [runs, total] = await Promise.all([
    PayrollRun.find(filter).populate(RUN_POPULATE).sort({ period: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    PayrollRun.countDocuments(filter),
  ]);

  return sendResponse(res, { data: runs, meta: buildMeta({ page, limit, total }) });
});

/** GET /payroll/runs/:id — with its payslips. */
export const getRun = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findById(req.params.id).populate(RUN_POPULATE).lean({ virtuals: true });
  if (!run) throw ApiError.notFound('Payroll run not found');

  const payslips = await Payslip.find({ payrollRunId: run._id, isActive: true })
    .populate(PAYSLIP_POPULATE)
    .sort({ staffName: 1 })
    .lean({ virtuals: true });

  return sendResponse(res, { data: { ...run, payslips } });
});

/**
 * POST /payroll/runs — open a month and compute every payslip.
 *
 * `expectedWorkingDays` defaults to the weekdays in the month but is stored on
 * the run, because which days count is a policy the hospital owns — a ward
 * running seven days a week would set it differently.
 */
export const createRun = asyncHandler(async (req, res) => {
  const existing = await PayrollRun.findOne({ period: req.body.period, isActive: true }).lean();
  if (existing) {
    throw ApiError.conflict(`A payroll run for ${req.body.period} already exists`, {
      code: 'RUN_EXISTS',
      details: { runId: existing._id, status: existing.status },
    });
  }

  const run = await PayrollRun.create({
    period: req.body.period,
    expectedWorkingDays: req.body.expectedWorkingDays ?? weekdaysIn(req.body.period),
    overtimeMultiplier: req.body.overtimeMultiplier ?? 1.5,
    notes: req.body.notes ?? '',
    status: 'draft',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  const { created, skipped } = await buildRun({ run, user: req.user });

  await run.populate(RUN_POPULATE);
  return sendCreated(res, {
    message: `Run opened for ${run.period} — ${created} payslip(s), net ${run.totalNet}` +
      (skipped.length ? `. ${skipped.length} staff skipped.` : ''),
    data: run,
    meta: { created, skipped },
  });
});

/** POST /payroll/runs/:id/rebuild — recompute a draft from current attendance. */
export const rebuildRun = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findById(req.params.id);
  if (!run) throw ApiError.notFound('Payroll run not found');

  assertEditable(run);

  if (req.body.expectedWorkingDays) run.expectedWorkingDays = req.body.expectedWorkingDays;
  if (req.body.overtimeMultiplier) run.overtimeMultiplier = req.body.overtimeMultiplier;

  const { created, skipped } = await buildRun({ run, user: req.user });

  await run.populate(RUN_POPULATE);
  return sendResponse(res, {
    message: `Rebuilt — ${created} payslip(s), net ${run.totalNet}`,
    data: run,
    meta: { created, skipped },
  });
});

/**
 * POST /payroll/runs/:id/approve — sign the run off.
 *
 * Gated on `payroll.approve`, which no role holds explicitly: admin-only. The
 * accountant who built the run cannot authorise paying it, for the same reason
 * a discount needs two people.
 */
export const approveRun = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findById(req.params.id);
  if (!run) throw ApiError.notFound('Payroll run not found');

  assertTransition(run.status, 'approved');

  if (run.payslipCount === 0) {
    throw ApiError.conflict('This run has no payslips to approve', { code: 'EMPTY_RUN' });
  }

  if (run.builtBy && String(run.builtBy) === String(req.user._id)) {
    throw ApiError.conflict(
      'A payroll run cannot be approved by the person who built it.',
      { code: 'SELF_APPROVAL' },
    );
  }

  run.status = 'approved';
  run.approvedBy = req.user._id;
  run.approvedAt = new Date();
  run.approvalNotes = req.body.notes ?? '';
  run.updatedBy = req.user._id;
  await run.save();

  await run.populate(RUN_POPULATE);
  return sendResponse(res, {
    message: `Run approved — ${run.totalNet} authorised across ${run.payslipCount} payslip(s)`,
    data: run,
  });
});

/** POST /payroll/runs/:id/pay — the money has gone out. */
export const markPaid = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findById(req.params.id);
  if (!run) throw ApiError.notFound('Payroll run not found');

  assertTransition(run.status, 'paid');

  run.status = 'paid';
  run.processedAt = new Date();
  run.paymentReference = req.body.paymentReference ?? '';
  run.updatedBy = req.user._id;
  await run.save();

  await run.populate(RUN_POPULATE);
  return sendResponse(res, { message: 'Run marked as paid', data: run });
});

/** POST /payroll/runs/:id/cancel — abandon a run and its payslips. */
export const cancelRun = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findById(req.params.id);
  if (!run) throw ApiError.notFound('Payroll run not found');

  assertTransition(run.status, 'cancelled');

  await Payslip.updateMany(
    { payrollRunId: run._id },
    { $set: softDeletePatch(req.user) },
  );

  run.status = 'cancelled';
  run.cancelledAt = new Date();
  run.cancelledBy = req.user._id;
  run.cancellationReason = req.body.reason;
  run.updatedBy = req.user._id;
  await run.save();

  await run.populate(RUN_POPULATE);
  return sendResponse(res, { message: 'Run cancelled', data: run });
});

// ---------------------------------------------------------------- payslips ----

/** GET /payroll/payslips */
export const listPayslips = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-period' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.payrollRunId ? { payrollRunId: query.payrollRunId } : null,
    query.userId ? { userId: query.userId } : null,
    query.period ? { period: query.period } : null,
  );

  const [payslips, total] = await Promise.all([
    Payslip.find(filter).populate(PAYSLIP_POPULATE).sort({ period: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Payslip.countDocuments(filter),
  ]);

  return sendResponse(res, { data: payslips, meta: buildMeta({ page, limit, total }) });
});

/**
 * GET /payroll/payslips/me — your own payslips.
 *
 * Needs no payroll grant beyond `payroll.viewOwn`, which every role holds.
 * Separate from the list above so reading your own pay never depends on being
 * able to read everyone's.
 */
export const listOwnPayslips = asyncHandler(async (req, res) => {
  const payslips = await Payslip.find({ userId: req.user._id, isActive: true })
    .populate({ path: 'payrollRunId', select: 'period status approvedAt processedAt' })
    .sort({ period: -1 })
    .lean({ virtuals: true });

  // Only what has been authorised — a draft figure is not yet anyone's pay.
  const visible = payslips.filter((slip) =>
    ['approved', 'paid'].includes(slip.payrollRunId?.status),
  );

  return sendResponse(res, {
    data: visible,
    meta: { count: visible.length, pendingRuns: payslips.length - visible.length },
  });
});

/**
 * Load the payslip so the ownership guard can see whose it is.
 *
 * Runs BEFORE `requirePermissionOrOwn`, which needs the owner to decide. It
 * attaches the record and nothing more — the guard still does the deciding, and
 * an unauthorised caller never reaches the handler that would return it.
 */
export const loadPayslip = asyncHandler(async (req, _res, next) => {
  const payslip = await Payslip.findById(req.params.id)
    .populate(PAYSLIP_POPULATE)
    .lean({ virtuals: true });
  if (!payslip) throw ApiError.notFound('Payslip not found');

  req.payslip = payslip;
  req.payslipOwnerId = payslip.userId?._id ?? payslip.userId;
  return next();
});

/**
 * GET /payroll/payslips/:id
 *
 * Gated with `requirePermissionOrOwn`: an accountant may read anyone's, and
 * anyone may read their own.
 */
export const getPayslip = asyncHandler(async (req, res) => {
  const payslip = req.payslip;

  // Own-payslip access is limited to authorised runs: a draft figure is not
  // yet anyone's pay, and showing it invites arguments about numbers that are
  // still moving. An accountant reading with `view` sees drafts as normal.
  if (req.permission?.action === 'viewOwn') {
    if (!['approved', 'paid'].includes(payslip.payrollRunId?.status)) {
      throw ApiError.notFound('That payslip has not been issued yet');
    }
  }

  return sendResponse(res, { data: payslip });
});
