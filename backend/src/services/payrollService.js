import {
  Attendance,
  SalaryStructure,
  Payslip,
  User,
  PAYABLE_FRACTION,
  STANDARD_SHIFT_HOURS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Pay computation.
 *
 * ---------------------------------------------------------------------------
 * THE POLICY, STATED EXPLICITLY
 * ---------------------------------------------------------------------------
 * Payroll rules differ between hospitals and between countries, so the choices
 * made here are written down rather than buried:
 *
 *   1. **Basic pay is pro-rated by attendance**, as
 *      `basic × payableDays ÷ expectedWorkingDays`. A day never recorded is a
 *      day never paid.
 *   2. **Allowances are NOT pro-rated.** A housing allowance does not shrink
 *      because someone was off sick on Tuesday.
 *   3. **Overtime** is paid at `basic ÷ (expectedWorkingDays × 8) × multiplier`
 *      per hour, from hours beyond a standard shift.
 *   4. **Percentage components are computed against the pro-rated basic**, not
 *      the full basic — a pension contribution follows what was actually earned.
 *   5. Deductions never take net pay below zero.
 *
 * Change them here; nothing else computes pay.
 */

const round = (value) => Math.round(value * 100) / 100;

/** First and last instant of a YYYY-MM period, in local time. */
export function periodBounds(period) {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

/** Weekdays in a period — the usual default for expected working days. */
export function weekdaysIn(period) {
  const { start, end } = periodBounds(period);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Summarise one person's attendance over a period.
 *
 * Only **approved** records count toward pay when any approval exists for the
 * period; where a hospital does not approve attendance at all, everything
 * counts. That way turning approval on later does not retroactively zero
 * everybody's pay.
 */
export async function attendanceSummary({ userId, period }) {
  const { start, end } = periodBounds(period);

  const records = await Attendance.find({
    userId,
    isActive: true,
    date: { $gte: start, $lte: end },
  }).lean();

  const anyApproved = records.some((row) => row.approvedBy);
  const counted = anyApproved ? records.filter((row) => row.approvedBy) : records;

  const summary = {
    daysPresent: 0,
    daysAbsent: 0,
    daysLeave: 0,
    daysHalf: 0,
    payableDays: 0,
    overtimeHours: 0,
    recorded: counted.length,
    requiresApproval: anyApproved,
  };

  for (const row of counted) {
    if (row.status === 'present') summary.daysPresent += 1;
    else if (row.status === 'absent') summary.daysAbsent += 1;
    else if (row.status === 'leave') summary.daysLeave += 1;
    else if (row.status === 'half-day') summary.daysHalf += 1;

    summary.payableDays += PAYABLE_FRACTION[row.status] ?? 0;
    summary.overtimeHours += row.overtimeHours ?? 0;
  }

  summary.payableDays = round(summary.payableDays);
  summary.overtimeHours = round(summary.overtimeHours);
  return summary;
}

/** The salary structure in force for a person at the end of a period. */
export async function structureFor({ userId, period }) {
  const { end } = periodBounds(period);

  return SalaryStructure.findOne({
    userId,
    isActive: true,
    effectiveFrom: { $lte: end },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: end } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean();
}

/**
 * Compute one payslip. Pure arithmetic over the inputs — no database access —
 * so the policy above can be exercised directly.
 */
export function computePayslip({
  structure,
  attendance,
  expectedWorkingDays,
  overtimeMultiplier = 1.5,
}) {
  const basic = structure.basicSalary ?? 0;

  // 1. Basic, pro-rated by attendance. Capped at 1 so recorded overtime days
  //    cannot inflate basic pay — overtime is paid separately.
  const factor = Math.min(1, (attendance.payableDays ?? 0) / expectedWorkingDays);
  const proratedBasic = round(basic * factor);

  // 3. Overtime, from the full-month hourly rate.
  const hourlyRate = basic / (expectedWorkingDays * STANDARD_SHIFT_HOURS);
  const overtimePay = round((attendance.overtimeHours ?? 0) * hourlyRate * overtimeMultiplier);

  // 2 & 4. Allowances are fixed; percentages follow the pro-rated basic.
  const allowances = (structure.allowances ?? []).map((line) => ({
    label: line.label,
    percentOfBasic: line.percentOfBasic ?? null,
    amount:
      line.percentOfBasic !== null && line.percentOfBasic !== undefined
        ? round((proratedBasic * line.percentOfBasic) / 100)
        : round(line.amount ?? 0),
  }));

  const totalAllowances = round(allowances.reduce((sum, line) => sum + line.amount, 0));
  const gross = round(proratedBasic + overtimePay + totalAllowances);

  const deductions = (structure.deductions ?? []).map((line) => ({
    label: line.label,
    percentOfBasic: line.percentOfBasic ?? null,
    amount:
      line.percentOfBasic !== null && line.percentOfBasic !== undefined
        ? round((proratedBasic * line.percentOfBasic) / 100)
        : round(line.amount ?? 0),
  }));

  const totalDeductions = round(deductions.reduce((sum, line) => sum + line.amount, 0));

  // 5. Never below zero.
  const net = round(Math.max(0, gross - totalDeductions));

  return {
    basicSalary: basic,
    expectedWorkingDays,
    daysPresent: attendance.daysPresent ?? 0,
    daysAbsent: attendance.daysAbsent ?? 0,
    daysLeave: attendance.daysLeave ?? 0,
    daysHalf: attendance.daysHalf ?? 0,
    payableDays: attendance.payableDays ?? 0,
    overtimeHours: attendance.overtimeHours ?? 0,
    proratedBasic,
    overtimePay,
    allowances,
    deductions,
    totalAllowances,
    totalDeductions,
    gross,
    net,
  };
}

/**
 * Build (or rebuild) every payslip on a draft run.
 *
 * Staff without a salary structure are skipped and reported rather than paid
 * zero — a missing structure is a data problem to fix, not a decision to pay
 * someone nothing.
 */
export async function buildRun({ run, user }) {
  const staff = await User.find({ isActive: true }).select('firstName lastName role').lean();

  // A rebuild replaces the previous draft figures wholesale.
  await Payslip.deleteMany({ payrollRunId: run._id });

  const created = [];
  const skipped = [];

  for (const member of staff) {
    const structure = await structureFor({ userId: member._id, period: run.period });
    if (!structure) {
      skipped.push({
        userId: member._id,
        name: `${member.firstName} ${member.lastName}`.trim(),
        reason: 'No salary structure in force for this period',
      });
      continue;
    }

    const attendance = await attendanceSummary({ userId: member._id, period: run.period });
    const computed = computePayslip({
      structure,
      attendance,
      expectedWorkingDays: run.expectedWorkingDays,
      overtimeMultiplier: run.overtimeMultiplier,
    });

    const payslip = await Payslip.create({
      ...computed,
      payrollRunId: run._id,
      userId: member._id,
      staffName: `${member.firstName} ${member.lastName}`.trim(),
      staffRole: member.role,
      period: run.period,
      salaryStructureId: structure._id,
      createdBy: user?._id ?? null,
      updatedBy: user?._id ?? null,
    });

    created.push(payslip);
  }

  run.payslipCount = created.length;
  run.totalGross = round(created.reduce((sum, p) => sum + p.gross, 0));
  run.totalDeductions = round(created.reduce((sum, p) => sum + p.totalDeductions, 0));
  run.totalNet = round(created.reduce((sum, p) => sum + p.net, 0));
  run.builtBy = user?._id ?? null;
  run.builtAt = new Date();
  run.updatedBy = user?._id ?? null;
  await run.save();

  return { created: created.length, skipped, run };
}

/** Refuse to touch a run that has been signed off. */
export function assertEditable(run) {
  if (run.status !== 'draft') {
    throw ApiError.conflict(
      `This run is ${run.status} and can no longer be changed. Cancel it and build another if the figures are wrong.`,
      { code: 'RUN_NOT_EDITABLE', details: { status: run.status } },
    );
  }
}

export default {
  periodBounds,
  weekdaysIn,
  attendanceSummary,
  structureFor,
  computePayslip,
  buildRun,
  assertEditable,
};
