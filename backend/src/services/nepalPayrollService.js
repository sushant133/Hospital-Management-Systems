import {
  SSF,
  PROVIDENT_FUND,
  GRATUITY,
  FESTIVAL_EXPENSE,
  TAX_BANDS,
  TAX_RELIEFS,
  SSF_EXEMPTS_FIRST_BAND,
  resolveScheme,
} from '../config/nepalPayroll.js';
import { roundPaisa, fiscalYearOf } from '../utils/nepal.js';

/**
 * ============================================================================
 * NEPALI PAYROLL COMPUTATION
 * ============================================================================
 *
 * Turns a salary structure into a payslip under the Labour Act 2074 and the
 * current Finance Act.
 *
 * ---------------------------------------------------------------------------
 * WHY TAX IS ANNUALISED AND NOT MONTHLY
 * ---------------------------------------------------------------------------
 * Nepali income tax is assessed on the fiscal year, on progressive bands. You
 * cannot compute a month's tax by taxing a month's pay — an employee whose
 * annual income crosses a band boundary in Magh would be under-deducted for
 * nine months and then hit with the whole difference in the last three.
 *
 * So each run projects the employee's income to the end of the fiscal year,
 * computes the annual liability, subtracts what has already been withheld, and
 * spreads the remainder over the months left. That also makes a mid-year raise
 * or a festival bonus settle smoothly instead of producing one brutal payslip.
 */

/** Progressive tax on an annual assessable income, band by band. */
export function annualTax(assessableIncome, { taxStatus = 'individual', ssfEnrolled = false } = {}) {
  const bands = TAX_BANDS[taxStatus] || TAX_BANDS.individual;

  let remaining = Math.max(0, assessableIncome);
  let previousCeiling = 0;
  let tax = 0;
  const breakdown = [];

  for (const band of bands) {
    if (remaining <= 0) break;

    const width = band.upTo === Infinity ? remaining : band.upTo - previousCeiling;
    const taxableHere = Math.min(remaining, width);

    // The 1% first band IS the social security tax. An employee already
    // contributing to SSF has discharged it, so charging it again over-deducts
    // from everyone on the fund.
    const isSocialSecurityBand = band.percent === 1 && band.label;
    const exempt = isSocialSecurityBand && ssfEnrolled && SSF_EXEMPTS_FIRST_BAND;

    const bandTax = exempt ? 0 : roundPaisa((taxableHere * band.percent) / 100);

    breakdown.push({
      from: previousCeiling,
      to: band.upTo === Infinity ? null : band.upTo,
      percent: band.percent,
      taxableAmount: roundPaisa(taxableHere),
      tax: bandTax,
      exempt,
      label: band.label || `${band.percent}%`,
    });

    tax += bandTax;
    remaining -= taxableHere;
    previousCeiling = band.upTo;
  }

  return { tax: roundPaisa(tax), breakdown };
}

/**
 * Deductions that reduce assessable income before the bands are applied.
 * Each is capped, and the caps interact — the retirement cap is the lesser of a
 * flat ceiling and a percentage of income.
 */
export function assessableIncome({
  grossAnnual,
  retirementContribution = 0,
  medicalInsurancePremium = 0,
  lifeInsurancePremium = 0,
  hasDisability = false,
  remoteAreaBand = null,
}) {
  const reliefs = [];

  const retirementCap = Math.min(
    TAX_RELIEFS.retirementContributionCap,
    roundPaisa((grossAnnual * TAX_RELIEFS.retirementContributionPercentCap) / 100),
  );
  const retirement = Math.min(retirementContribution, retirementCap);
  if (retirement > 0) {
    reliefs.push({ label: 'Retirement contribution', amount: roundPaisa(retirement) });
  }

  const medical = Math.min(medicalInsurancePremium, TAX_RELIEFS.medicalInsuranceCap);
  if (medical > 0) reliefs.push({ label: 'Medical insurance premium', amount: roundPaisa(medical) });

  const life = Math.min(lifeInsurancePremium, TAX_RELIEFS.lifeInsuranceCap);
  if (life > 0) reliefs.push({ label: 'Life insurance premium', amount: roundPaisa(life) });

  const remote = remoteAreaBand ? TAX_RELIEFS.remoteAreaAllowance[remoteAreaBand] || 0 : 0;
  if (remote > 0) reliefs.push({ label: `Remote area allowance (${remoteAreaBand})`, amount: remote });

  const disability = hasDisability
    ? roundPaisa((grossAnnual * TAX_RELIEFS.disabilityAllowancePercent) / 100)
    : 0;
  if (disability > 0) reliefs.push({ label: 'Disability allowance', amount: disability });

  const totalRelief = roundPaisa(reliefs.reduce((sum, r) => sum + r.amount, 0));

  return {
    grossAnnual: roundPaisa(grossAnnual),
    reliefs,
    totalRelief,
    assessable: roundPaisa(Math.max(0, grossAnnual - totalRelief)),
  };
}

/**
 * Compute one monthly payslip.
 *
 * @param {object} input
 * @param {number} input.basicSalary          Monthly basic — the base for every statutory levy.
 * @param {Array}  input.allowances           `[{ label, amount, taxable }]`
 * @param {Array}  input.otherDeductions      `[{ label, amount }]` — advances, loans, fines.
 * @param {object} input.employee             `{ ssfEnrolled, taxStatus, hasDisability, remoteAreaBand, joinedOn }`
 * @param {number} input.taxPaidToDate        Withheld so far this fiscal year.
 * @param {number} input.monthsRemaining      Including this one. Drives the tax spread.
 * @param {number} input.payableFraction      1 for a full month; less for unpaid absence.
 * @param {boolean} input.includeFestival     True on the run that carries the Dashain payment.
 */
export function computePayslip({
  basicSalary,
  allowances = [],
  otherDeductions = [],
  employee = {},
  taxPaidToDate = 0,
  monthsRemaining = 1,
  payableFraction = 1,
  includeFestival = false,
  asOf = new Date(),
}) {
  const {
    ssfEnrolled = SSF.enabled,
    taxStatus = 'individual',
    hasDisability = false,
    remoteAreaBand = null,
    joinedOn = null,
  } = employee;

  const scheme = resolveScheme({ ssfEnrolled });

  // Unpaid absence scales pay, but the statutory bases scale with it too —
  // SSF on a half-paid month is levied on the half that was paid.
  const basic = roundPaisa(basicSalary * payableFraction);
  const allowanceTotal = roundPaisa(
    allowances.reduce((sum, a) => sum + a.amount * payableFraction, 0),
  );

  // --- Festival expense: one month's basic, pro-rated in the first year ---
  let festival = 0;
  if (includeFestival) {
    let fraction = 1;
    if (FESTIVAL_EXPENSE.proRateFirstYear && joinedOn) {
      const monthsServed =
        (asOf.getFullYear() - new Date(joinedOn).getFullYear()) * 12 +
        (asOf.getMonth() - new Date(joinedOn).getMonth());
      if (monthsServed < 12) fraction = Math.max(0, monthsServed) / 12;
    }
    festival = roundPaisa(basicSalary * FESTIVAL_EXPENSE.months * fraction);
  }

  const grossEarnings = roundPaisa(basic + allowanceTotal + festival);

  /* --- Statutory contributions -------------------------------------- */
  const earnings = [
    { label: 'Basic salary', labelNe: 'आधारभूत तलब', amount: basic, taxable: true },
    ...allowances.map((a) => ({
      label: a.label,
      labelNe: a.labelNe || '',
      amount: roundPaisa(a.amount * payableFraction),
      taxable: a.taxable !== false,
    })),
  ];
  if (festival > 0) {
    earnings.push({
      label: 'Festival expense',
      labelNe: 'चाडपर्व खर्च',
      amount: festival,
      taxable: true,
    });
  }

  const deductions = [];
  const employerContributions = [];

  if (scheme.ssf) {
    const employeeSsf = roundPaisa((basic * SSF.employeePercent) / 100);
    const employerSsf = roundPaisa((basic * SSF.employerPercent) / 100);
    deductions.push({
      label: `SSF employee contribution (${SSF.employeePercent}%)`,
      labelNe: 'सामाजिक सुरक्षा कोष (कर्मचारी)',
      amount: employeeSsf,
      statutory: true,
    });
    // Employer share is a cost to the hospital and part of the SSF return, but
    // it is NOT withheld from the employee — listing it as a deduction is the
    // classic bug that understates every payslip by 20% of basic.
    employerContributions.push({
      label: `SSF employer contribution (${SSF.employerPercent}%)`,
      labelNe: 'सामाजिक सुरक्षा कोष (रोजगारदाता)',
      amount: employerSsf,
    });
  }

  if (scheme.providentFund) {
    const employeePf = roundPaisa((basic * PROVIDENT_FUND.employeePercent) / 100);
    deductions.push({
      label: `Provident fund (${PROVIDENT_FUND.employeePercent}%)`,
      labelNe: 'सञ्चय कोष',
      amount: employeePf,
      statutory: true,
    });
    employerContributions.push({
      label: `Provident fund — employer (${PROVIDENT_FUND.employerPercent}%)`,
      labelNe: 'सञ्चय कोष (रोजगारदाता)',
      amount: roundPaisa((basic * PROVIDENT_FUND.employerPercent) / 100),
    });
  }

  if (scheme.gratuity) {
    employerContributions.push({
      label: `Gratuity accrual (${GRATUITY.percent}%)`,
      labelNe: 'उपदान',
      amount: roundPaisa((basic * GRATUITY.percent) / 100),
    });
  }

  const statutoryEmployeeTotal = roundPaisa(
    deductions.filter((d) => d.statutory).reduce((sum, d) => sum + d.amount, 0),
  );

  /* --- Tax: annualise, then take this month's share ------------------ */
  const taxableMonthly = roundPaisa(
    earnings.filter((e) => e.taxable).reduce((sum, e) => sum + e.amount, 0),
  );

  // Project to year end. The festival payment is a one-off, so it is added once
  // rather than multiplied across the remaining months.
  const recurringMonthly = roundPaisa(taxableMonthly - festival);
  const projectedAnnual = roundPaisa(
    recurringMonthly * 12 + festival + (employee.incomeToDateAdjustment || 0),
  );

  const assessment = assessableIncome({
    grossAnnual: projectedAnnual,
    retirementContribution: roundPaisa(statutoryEmployeeTotal * 12),
    medicalInsurancePremium: employee.medicalInsurancePremium || 0,
    lifeInsurancePremium: employee.lifeInsurancePremium || 0,
    hasDisability,
    remoteAreaBand,
  });

  const { tax: annualLiability, breakdown: taxBreakdown } = annualTax(assessment.assessable, {
    taxStatus,
    ssfEnrolled: scheme.ssf,
  });

  const outstandingTax = roundPaisa(Math.max(0, annualLiability - taxPaidToDate));
  const monthlyTax = roundPaisa(outstandingTax / Math.max(1, monthsRemaining));

  if (monthlyTax > 0) {
    deductions.push({
      label: 'Income tax (TDS)',
      labelNe: 'आय कर',
      amount: monthlyTax,
      statutory: true,
    });
  }

  for (const other of otherDeductions) {
    deductions.push({
      label: other.label,
      labelNe: other.labelNe || '',
      amount: roundPaisa(other.amount),
      statutory: false,
    });
  }

  const totalDeductions = roundPaisa(deductions.reduce((sum, d) => sum + d.amount, 0));
  const netPay = roundPaisa(grossEarnings - totalDeductions);

  return {
    fiscalYear: fiscalYearOf(asOf).code,
    earnings,
    grossEarnings,
    deductions,
    totalDeductions,
    /** Cost to the hospital beyond the payslip — for the salary budget. */
    employerContributions,
    employerCost: roundPaisa(
      grossEarnings + employerContributions.reduce((sum, c) => sum + c.amount, 0),
    ),
    netPay,
    tax: {
      projectedAnnualIncome: projectedAnnual,
      assessableIncome: assessment.assessable,
      reliefs: assessment.reliefs,
      annualLiability,
      paidToDate: roundPaisa(taxPaidToDate),
      thisMonth: monthlyTax,
      taxStatus,
      breakdown: taxBreakdown,
    },
    scheme,
  };
}

/**
 * The monthly SSF return.
 *
 * The Fund wants employee and employer shares per member, allocated across the
 * four schemes. Built from payslips rather than recomputed, so the return can
 * never disagree with what was actually deducted.
 */
export function ssfReturn({ payslips, period }) {
  const rows = [];
  let employeeTotal = 0;
  let employerTotal = 0;

  for (const slip of payslips) {
    const employeeShare =
      slip.deductions?.find((d) => d.label?.startsWith('SSF employee'))?.amount || 0;
    const employerShare =
      slip.employerContributions?.find((c) => c.label?.startsWith('SSF employer'))?.amount || 0;
    if (employeeShare === 0 && employerShare === 0) continue;

    const combined = roundPaisa(employeeShare + employerShare);
    rows.push({
      employeeId: slip.employeeId,
      ssfNumber: slip.ssfNumber || '',
      name: slip.employeeName,
      basicSalary: slip.basicSalary,
      employeeContribution: employeeShare,
      employerContribution: employerShare,
      total: combined,
      allocation: Object.fromEntries(
        Object.entries(SSF.allocation).map(([scheme, percent]) => [
          scheme,
          roundPaisa((slip.basicSalary * percent) / 100),
        ]),
      ),
    });
    employeeTotal += employeeShare;
    employerTotal += employerShare;
  }

  return {
    period,
    rows,
    employeeTotal: roundPaisa(employeeTotal),
    employerTotal: roundPaisa(employerTotal),
    grandTotal: roundPaisa(employeeTotal + employerTotal),
  };
}

export default { computePayslip, annualTax, assessableIncome, ssfReturn };
