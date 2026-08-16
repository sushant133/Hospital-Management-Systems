import { HmisReturn } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import {
  generateMonthlyReturn,
  toDhis2DataValueSet,
  submitToDhis2,
  periodLabel,
  INDICATORS,
} from '../services/hmisService.js';
import { RETURN_KINDS } from '../models/HmisReturn.js';
import config from '../config/env.js';
import {
  BS_MONTHS_EN,
  BS_MONTHS_NE,
  fiscalYearOf,
  bsMonthRange,
  FISCAL_YEAR_START_MONTH,
} from '../utils/nepal.js';

export const listReturns = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-periodEnd' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.status ? { status: query.status } : null,
    query.bsYear ? { bsYear: query.bsYear } : null,
    query.fiscalYear ? { fiscalYear: query.fiscalYear } : null,
  );

  const [rows, total] = await Promise.all([
    HmisReturn.find(filter)
      .populate({ path: 'generatedBy approvedBy submittedBy', select: 'firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    HmisReturn.countDocuments(filter),
  ]);

  return sendResponse(res, {
    data: rows.map((row) => ({
      ...row.toObject(),
      periodLabel: periodLabel({ bsYear: row.bsYear, bsMonth: row.bsMonth }),
    })),
    meta: buildMeta({ page, limit, total }),
  });
});

export const getReturn = asyncHandler(async (req, res) => {
  const row = await HmisReturn.findById(req.params.id).populate({
    path: 'generatedBy reviewedBy approvedBy submittedBy',
    select: 'firstName lastName role',
  });
  if (!row) throw ApiError.notFound('Return not found');

  return sendResponse(res, {
    data: row,
    meta: {
      periodLabel: periodLabel({ bsYear: row.bsYear, bsMonth: row.bsMonth }),
      periodLabelNe: `${BS_MONTHS_NE[row.bsMonth - 1]} ${row.bsYear}`,
      /** Indicators with no DHIS2 mapping cannot be pushed electronically. */
      unmappedIndicators: row.indicators.filter((i) => !i.dataElement).map((i) => i.code),
    },
  });
});

/**
 * Build the monthly return for a BS month.
 *
 * A period that already carries an approved or submitted return is not edited —
 * that return is a statement the facility made on a date and has to survive.
 * Instead a restatement is generated, chained to the original, with a stated
 * reason.
 */
export const generate = asyncHandler(async (req, res) => {
  const { bsYear, bsMonth, restatementReason } = req.body;

  const existing = await HmisReturn.findOne({
    kind: RETURN_KINDS.HMIS_MONTHLY,
    bsYear,
    bsMonth,
    facilityCode: config.hmis.facilityCode,
    regeneratedFrom: null,
    isActive: true,
  });

  let regeneratedFrom = null;

  if (existing) {
    if (['draft', 'under-review'].includes(existing.status)) {
      // Nothing has been asserted yet, so a plain rebuild is honest.
      await HmisReturn.deleteOne({ _id: existing._id });
    } else {
      if (!restatementReason || restatementReason.trim().length < 10) {
        throw ApiError.conflict(
          `The ${periodLabel({ bsYear, bsMonth })} return has already been ${existing.status}. ` +
            'Regenerating it produces a restatement — give a reason of at least 10 characters.',
          { code: 'RESTATEMENT_REASON_REQUIRED' },
        );
      }
      regeneratedFrom = existing._id;
    }
  }

  const row = await generateMonthlyReturn({
    bsYear,
    bsMonth,
    user: req.user,
    regeneratedFrom,
    restatementReason: restatementReason || '',
  });

  const unavailable = row.indicators.filter((i) => i.derivation.includes('NOT AVAILABLE'));

  return sendCreated(res, {
    message: regeneratedFrom
      ? `Restatement generated for ${periodLabel({ bsYear, bsMonth })}`
      : `Return generated for ${periodLabel({ bsYear, bsMonth })}`,
    data: row,
    meta: {
      // Reported explicitly: a reviewer reads a zero as "no cases", which is a
      // different claim from "this hospital does not run that service".
      unavailableIndicators: unavailable.map((i) => ({ code: i.code, note: i.derivation })),
    },
  });
});

/**
 * Record the statistician's check, with any manual corrections.
 *
 * An override never replaces the computed figure — it sits beside it with a
 * reason, so the return shows both what the data said and what a human decided
 * it should say.
 */
export const review = asyncHandler(async (req, res) => {
  const row = await HmisReturn.findById(req.params.id);
  if (!row) throw ApiError.notFound('Return not found');

  if (['approved', 'submitted', 'accepted'].includes(row.status)) {
    throw ApiError.conflict(
      `This return was already ${row.status}. Generate a restatement instead of revising it.`,
      { code: 'RETURN_FROZEN' },
    );
  }

  for (const override of req.body.overrides || []) {
    const indicator = row.indicators.find((i) => i.code === override.code);
    if (!indicator) {
      throw ApiError.badRequest(`No indicator "${override.code}" on this return.`);
    }
    indicator.overriddenValue = override.value;
    indicator.overrideReason = override.reason;
  }

  row.status = 'under-review';
  row.reviewedBy = req.user._id;
  row.reviewedAt = new Date();
  row.reviewNotes = req.body.reviewNotes || '';
  row.updatedBy = req.user._id;
  await row.save();

  return sendResponse(res, { message: 'Return reviewed', data: row });
});

/**
 * Sign off.
 *
 * This is the act that makes the figures the facility's official statement, and
 * MoHP comes back to the named approver about them — which is why it is held
 * under a tighter grant than generating a draft, and why the return freezes
 * afterwards.
 */
export const approve = asyncHandler(async (req, res) => {
  const row = await HmisReturn.findById(req.params.id);
  if (!row) throw ApiError.notFound('Return not found');

  if (row.status !== 'under-review') {
    throw ApiError.conflict(
      'A return must be reviewed before it is approved — approving an unchecked draft ' +
        'is how a wrong figure reaches the Ministry.',
      { code: 'REVIEW_REQUIRED' },
    );
  }

  row.status = 'approved';
  row.approvedBy = req.user._id;
  row.approvedAt = new Date();
  row.updatedBy = req.user._id;
  await row.save();

  return sendResponse(res, { message: 'Return approved and frozen', data: row });
});

/** Push an approved return to the national DHIS2 instance. */
export const submit = asyncHandler(async (req, res) => {
  const row = await HmisReturn.findById(req.params.id);
  if (!row) throw ApiError.notFound('Return not found');

  if (row.status !== 'approved') {
    throw ApiError.conflict('Only an approved return may be submitted.', {
      code: 'APPROVAL_REQUIRED',
    });
  }

  const result = await submitToDhis2(row);

  if (!result.ok) {
    // Not an error: a facility without DHIS2 credentials submits on paper, and
    // recording that is a legitimate outcome rather than a failure.
    return sendResponse(res, {
      message: `Electronic submission not possible: ${result.reason || 'DHIS2 rejected the push.'}`,
      data: {
        return: row,
        exportPayload: toDhis2DataValueSet(row),
      },
      meta: { ok: false, unmapped: result.unmapped ?? [] },
    });
  }

  row.status = 'submitted';
  row.submittedAt = new Date();
  row.submittedBy = req.user._id;
  row.submissionMethod = 'dhis2-api';
  row.dhis2Response = result.response;
  row.updatedBy = req.user._id;
  await row.save();

  return sendResponse(res, {
    message: 'Return submitted to DHIS2',
    data: row,
    meta: { unmapped: result.unmapped ?? [] },
  });
});

/** Mark a return as handed over on paper or by file. */
export const markSubmittedManually = asyncHandler(async (req, res) => {
  const row = await HmisReturn.findById(req.params.id);
  if (!row) throw ApiError.notFound('Return not found');
  if (row.status !== 'approved') {
    throw ApiError.conflict('Only an approved return may be recorded as submitted.');
  }

  row.status = 'submitted';
  row.submittedAt = new Date();
  row.submittedBy = req.user._id;
  row.submissionMethod = req.body?.method === 'file-export' ? 'file-export' : 'manual';
  row.updatedBy = req.user._id;
  await row.save();

  return sendResponse(res, { message: 'Return recorded as submitted', data: row });
});

/** The DHIS2 payload, for a facility that uploads the file by hand. */
export const exportDhis2 = asyncHandler(async (req, res) => {
  const row = await HmisReturn.findById(req.params.id);
  if (!row) throw ApiError.notFound('Return not found');

  const payload = toDhis2DataValueSet(row);
  return sendResponse(res, {
    data: payload,
    meta: {
      unmappedIndicators: payload.unmappedIndicators,
      note:
        payload.unmappedIndicators.length > 0
          ? 'These indicators have no DHIS2 data element mapped and will NOT be included. ' +
            'Complete the mapping during commissioning.'
          : undefined,
    },
  });
});

/**
 * Which periods are still owed.
 *
 * The question a facility in-charge actually asks — not "show me the returns"
 * but "what have we not sent yet".
 */
export const outstandingPeriods = asyncHandler(async (req, res) => {
  const fy = getQuery(req).fiscalYear ? null : fiscalYearOf();
  const fiscalYear = getQuery(req).fiscalYear || fy.code;

  const submitted = await HmisReturn.find({
    kind: RETURN_KINDS.HMIS_MONTHLY,
    fiscalYear,
    status: { $in: ['submitted', 'accepted'] },
    isActive: true,
  })
    .select('bsYear bsMonth')
    .lean();

  const done = new Set(submitted.map((r) => `${r.bsYear}-${r.bsMonth}`));
  const now = new Date();
  const startYear = Number(fiscalYear.split('-')[0]);

  // Walk the fiscal year's twelve months, Shrawan first. A month is only owed
  // once it has actually ended — listing the current month as outstanding would
  // make the facility look permanently behind.
  const pending = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const month = ((3 + offset) % 12) + 1; // 4,5,…,12,1,2,3
    const bsYear = month >= FISCAL_YEAR_START_MONTH ? startYear : startYear + 1;

    const { end } = bsMonthRange(bsYear, month);
    if (end > now) continue; // not finished yet
    if (done.has(`${bsYear}-${month}`)) continue;

    pending.push({ bsYear, bsMonth: month });
  }

  return sendResponse(res, {
    data: pending.map(({ bsYear, bsMonth }) => ({
      bsYear,
      bsMonth,
      label: `${BS_MONTHS_EN[bsMonth - 1]} ${bsYear}`,
      labelNe: `${BS_MONTHS_NE[bsMonth - 1]} ${bsYear}`,
    })),
    meta: { fiscalYear, submitted: submitted.length, asOf: now },
  });
});

/** The indicator catalogue, so the UI can explain what each figure counts. */
export const listIndicators = asyncHandler(async (_req, res) =>
  sendResponse(res, {
    data: INDICATORS.map(({ code, label, labelNe, derivation }) => ({
      code,
      label,
      labelNe,
      derivation,
    })),
    meta: {
      note:
        'Morbidity by diagnosis is not derived: it needs coded diagnoses, and diagnosis is ' +
        'currently free text. Producing a morbidity table from uncoded text would be inventing ' +
        'statistics.',
    },
  }),
);
