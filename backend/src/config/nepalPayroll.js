/**
 * ============================================================================
 * NEPALI STATUTORY PAYROLL PARAMETERS
 * ============================================================================
 *
 * ⚠ EVERY NUMBER HERE IS SET BY LAW OR BY THE ANNUAL FINANCE ACT, AND MOVES.
 *
 * They are gathered in one file, separate from the calculation logic, precisely
 * so that the yearly budget change is a one-file edit reviewed by the accounts
 * office — not a hunt through a service module. Each block carries the
 * instrument it comes from; record the operative circular there when you update
 * it, and confirm against the current Finance Act before the first payroll run
 * of a new fiscal year.
 *
 * The *structure* below (which contributions exist, what they are levied on,
 * how TDS is banded) is stable. Only the figures move.
 */

/* ==========================================================================
 * SOCIAL SECURITY FUND — Contribution Based Social Security Act, 2074
 * ==========================================================================
 * Levied on BASIC SALARY, not on gross pay. Both shares are remitted by the
 * employer, but only the employee share is deducted from take-home — putting
 * the employer share in the deduction column is the classic payroll bug and it
 * understates every payslip by a fifth of basic.
 */
export const SSF = Object.freeze({
  enabled: true,
  /** Withheld from the employee. */
  employeePercent: 11,
  /** Paid by the hospital on top of salary. Never a deduction. */
  employerPercent: 20,
  /** Levied on basic, not gross. */
  base: 'basic',

  /**
   * How the combined 31% is allocated across the four SSF schemes. Reported on
   * the monthly return; does not change the amount withheld.
   */
  allocation: Object.freeze({
    medicalAndMaternity: 1,
    accidentAndDisability: 1.4,
    dependentFamily: 0.27,
    oldAge: 28.33,
  }),
  authority: 'Contribution Based Social Security Act 2074 — verify current rates',
});

/* ==========================================================================
 * PROVIDENT FUND AND GRATUITY — Labour Act, 2074
 * ==========================================================================
 * For employers NOT enrolled in SSF. An employer in SSF contributes there
 * instead; running both is double-counting, which `resolveScheme` prevents.
 */
export const PROVIDENT_FUND = Object.freeze({
  employeePercent: 10,
  employerPercent: 10,
  base: 'basic',
  authority: 'Labour Act 2074 s.52 — verify',
});

export const GRATUITY = Object.freeze({
  /** 8.33% of basic, accrued monthly. */
  percent: 8.33,
  base: 'basic',
  authority: 'Labour Act 2074 s.53 — verify',
});

/* ==========================================================================
 * FESTIVAL EXPENSE (DASHAIN BONUS) — Labour Act, 2074
 * ==========================================================================
 * One month's basic salary, paid once a year before the employee's main
 * festival. Pro-rated for anyone who has served less than a full year.
 */
export const FESTIVAL_EXPENSE = Object.freeze({
  /** As a multiple of monthly basic. */
  months: 1,
  base: 'basic',
  /** BS month it is normally paid in — Ashwin, before Dashain. */
  defaultBsMonth: 6,
  /** Pro-rate below a full year of service. */
  proRateFirstYear: true,
  authority: 'Labour Act 2074 s.35 — verify',
});

/* ==========================================================================
 * INCOME TAX — annual Finance Act
 * ==========================================================================
 * Nepal taxes individuals and married couples on DIFFERENT bands: a couple
 * electing joint assessment gets a wider first band. The election is a property
 * of the employee, which is why `taxStatus` sits on the salary structure and
 * not in a global setting.
 *
 * Bands are annual and cumulative, expressed in rupees of assessable income.
 * The first band's rate is the social security tax, which does not apply to an
 * employee already contributing to SSF — hence `ssfExemptFirstBand`.
 */
export const TAX_BANDS = Object.freeze({
  individual: [
    { upTo: 500000, percent: 1, label: 'Social security tax' },
    { upTo: 700000, percent: 10 },
    { upTo: 1000000, percent: 20 },
    { upTo: 2000000, percent: 30 },
    { upTo: 5000000, percent: 36 },
    { upTo: Infinity, percent: 39 },
  ],
  couple: [
    { upTo: 600000, percent: 1, label: 'Social security tax' },
    { upTo: 800000, percent: 10 },
    { upTo: 1100000, percent: 20 },
    { upTo: 2000000, percent: 30 },
    { upTo: 5000000, percent: 36 },
    { upTo: Infinity, percent: 39 },
  ],
  authority: 'Finance Act — CONFIRM BANDS EACH FISCAL YEAR BEFORE THE FIRST RUN',
});

/**
 * The 1% first band is a social security tax, and an employee already
 * contributing to SSF does not pay it — their contribution discharges it.
 * Applying it anyway over-deducts from every SSF member on the payroll.
 */
export const SSF_EXEMPTS_FIRST_BAND = true;

/* ==========================================================================
 * ALLOWANCES AND RELIEFS
 * ======================================================================= */
export const TAX_RELIEFS = Object.freeze({
  /** Deductible retirement contributions are capped. */
  retirementContributionCap: 500000,
  retirementContributionPercentCap: 33.33,
  /** Approved medical insurance premium relief. */
  medicalInsuranceCap: 20000,
  /** Life insurance premium relief. */
  lifeInsuranceCap: 40000,
  /** Additional allowance for an employee with a recognised disability. */
  disabilityAllowancePercent: 50,
  /** Remote-area allowance bands A–E, by posting. */
  remoteAreaAllowance: Object.freeze({ A: 50000, B: 40000, C: 30000, D: 20000, E: 10000 }),
  authority: 'Income Tax Act 2058 / Finance Act — verify',
});

/* ==========================================================================
 * LEAVE — Labour Act, 2074
 * ======================================================================= */
export const LEAVE_ENTITLEMENTS = Object.freeze({
  /** Annual (home) leave: one day per twenty worked. */
  annualDaysPerYear: 18,
  /** Sick leave, half pay beyond the entitlement. */
  sickDaysPerYear: 12,
  /** Accumulation caps before the balance must be encashed or lapses. */
  annualAccumulationCap: 90,
  sickAccumulationCap: 45,
  /** Encashment is at basic rate. */
  encashmentBase: 'basic',
  maternityDays: 98,
  paternityDays: 15,
  mourningDays: 13,
  authority: 'Labour Act 2074 — verify',
});

/**
 * SSF and PF/gratuity are alternatives, not additives.
 *
 * An employer enrolled in the Social Security Fund contributes there and does
 * NOT separately run provident fund and gratuity — those obligations are
 * discharged by the SSF contribution. Running both deducts 21% of basic from an
 * employee who owes 11%, and over-charges the hospital by 20% of its payroll.
 */
export function resolveScheme({ ssfEnrolled }) {
  return ssfEnrolled
    ? { ssf: true, providentFund: false, gratuity: false }
    : { ssf: false, providentFund: true, gratuity: true };
}

export default {
  SSF,
  PROVIDENT_FUND,
  GRATUITY,
  FESTIVAL_EXPENSE,
  TAX_BANDS,
  TAX_RELIEFS,
  LEAVE_ENTITLEMENTS,
  SSF_EXEMPTS_FIRST_BAND,
  resolveScheme,
};
