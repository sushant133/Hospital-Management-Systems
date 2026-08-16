import test from 'node:test';
import assert from 'node:assert/strict';

import { computePayslip, annualTax, assessableIncome } from '../../src/services/nepalPayrollService.js';
import { SSF, TAX_BANDS } from '../../src/config/nepalPayroll.js';

/**
 * Payroll is a money path, and a wrong payslip is discovered by the employee,
 * not by a test — so the bands are asserted with worked examples rather than
 * against the implementation's own output.
 */

test('tax: progressive bands are applied cumulatively, not as a flat rate', () => {
  // 500,000 at 1% = 5,000; the next 200,000 at 10% = 20,000; the next 200,000
  // at 20% = 40,000.
  assert.equal(annualTax(400000, { taxStatus: 'individual' }).tax, 4000);
  assert.equal(annualTax(500000, { taxStatus: 'individual' }).tax, 5000);
  assert.equal(annualTax(700000, { taxStatus: 'individual' }).tax, 25000);
  assert.equal(annualTax(900000, { taxStatus: 'individual' }).tax, 65000);
});

test('tax: a couple gets the wider first bands', () => {
  // The couple election widens the 1% band to 600,000 and the 10% band to
  // 800,000 — worth 9,000 at an income of 700,000.
  const individual = annualTax(700000, { taxStatus: 'individual' }).tax;
  const couple = annualTax(700000, { taxStatus: 'couple' }).tax;
  assert.equal(individual, 25000);
  assert.equal(couple, 16000);
  assert.ok(couple < individual);
});

test('tax: SSF membership discharges the 1% social security band', () => {
  // The first band IS the social security tax. Charging it to someone already
  // contributing 11% of basic to SSF double-taxes them.
  const notInFund = annualTax(600000, { taxStatus: 'individual', ssfEnrolled: false }).tax;
  const inFund = annualTax(600000, { taxStatus: 'individual', ssfEnrolled: true }).tax;
  assert.equal(notInFund, 15000);
  assert.equal(inFund, 10000);
  assert.equal(notInFund - inFund, 5000); // exactly the 1% band

  const band = annualTax(600000, { ssfEnrolled: true }).breakdown[0];
  assert.equal(band.exempt, true);
  assert.equal(band.tax, 0);
});

test('tax: the top band has no ceiling', () => {
  const top = TAX_BANDS.individual.at(-1);
  assert.equal(top.upTo, Infinity);
  // A very large income must still compute rather than returning NaN.
  const result = annualTax(50000000, { taxStatus: 'individual' });
  assert.ok(Number.isFinite(result.tax) && result.tax > 0);
});

test('reliefs are capped, and the retirement cap is the lesser of two limits', () => {
  // 33.33% of 600,000 is ~200,000, well under the 500,000 flat cap, so the
  // percentage limit binds.
  const low = assessableIncome({ grossAnnual: 600000, retirementContribution: 300000 });
  const retirementRelief = low.reliefs.find((r) => r.label === 'Retirement contribution');
  assert.ok(retirementRelief.amount < 300000);
  assert.ok(retirementRelief.amount <= 600000 * 0.3333 + 1);

  // At a high income the flat 500,000 cap binds instead.
  const high = assessableIncome({ grossAnnual: 5000000, retirementContribution: 900000 });
  assert.equal(high.reliefs.find((r) => r.label === 'Retirement contribution').amount, 500000);
});

test('payslip: SSF is levied on basic, not on gross', () => {
  const slip = computePayslip({
    basicSalary: 50000,
    allowances: [{ label: 'Grade allowance', amount: 10000 }],
    employee: { ssfEnrolled: true },
    monthsRemaining: 12,
  });

  const ssfLine = slip.deductions.find((d) => d.label.startsWith('SSF employee'));
  // 11% of basic (50,000) = 5,500. 11% of gross (60,000) would be 6,600.
  assert.equal(ssfLine.amount, 5500);
  assert.notEqual(ssfLine.amount, 6600);
});

test('payslip: the employer SSF share is a cost, never a deduction', () => {
  // The classic payroll bug: listing the employer's 20% as a deduction
  // understates every payslip by a fifth of basic.
  const slip = computePayslip({
    basicSalary: 50000,
    employee: { ssfEnrolled: true },
    monthsRemaining: 12,
  });

  assert.ok(!slip.deductions.some((d) => d.label.toLowerCase().includes('employer')));

  const employerLine = slip.employerContributions.find((c) => c.label.startsWith('SSF employer'));
  assert.equal(employerLine.amount, 50000 * (SSF.employerPercent / 100));
  assert.equal(slip.employerCost, slip.grossEarnings + employerLine.amount);
});

test('payslip: SSF and provident fund are alternatives, never both', () => {
  // Running both deducts 21% of basic from an employee who owes 11%.
  const inFund = computePayslip({ basicSalary: 50000, employee: { ssfEnrolled: true } });
  assert.equal(inFund.scheme.ssf, true);
  assert.equal(inFund.scheme.providentFund, false);
  assert.ok(!inFund.deductions.some((d) => d.label.includes('Provident')));

  const notInFund = computePayslip({ basicSalary: 50000, employee: { ssfEnrolled: false } });
  assert.equal(notInFund.scheme.ssf, false);
  assert.equal(notInFund.scheme.providentFund, true);
  assert.ok(!notInFund.deductions.some((d) => d.label.includes('SSF')));
  // Gratuity accrues for the non-SSF employer.
  assert.ok(notInFund.employerContributions.some((c) => c.label.startsWith('Gratuity')));
});

test('payslip: net pay equals gross minus every deduction', () => {
  const slip = computePayslip({
    basicSalary: 50000,
    allowances: [{ label: 'Grade', amount: 10000 }],
    otherDeductions: [{ label: 'Staff advance', amount: 2000 }],
    employee: { ssfEnrolled: true },
    monthsRemaining: 12,
  });

  const summed = slip.deductions.reduce((total, d) => total + d.amount, 0);
  assert.equal(Math.round(summed * 100) / 100, slip.totalDeductions);
  assert.equal(
    Math.round((slip.grossEarnings - slip.totalDeductions) * 100) / 100,
    slip.netPay,
  );
});

test('payslip: unpaid absence scales pay and the statutory bases with it', () => {
  const full = computePayslip({ basicSalary: 50000, employee: { ssfEnrolled: true } });
  const half = computePayslip({
    basicSalary: 50000,
    employee: { ssfEnrolled: true },
    payableFraction: 0.5,
  });

  assert.equal(half.grossEarnings, full.grossEarnings / 2);
  // SSF follows the basic actually paid, not the contractual basic.
  const fullSsf = full.deductions.find((d) => d.label.startsWith('SSF employee')).amount;
  const halfSsf = half.deductions.find((d) => d.label.startsWith('SSF employee')).amount;
  assert.equal(halfSsf, fullSsf / 2);
});

test('payslip: the festival month adds one month of basic, taxed once', () => {
  const normal = computePayslip({ basicSalary: 50000, employee: { ssfEnrolled: true }, monthsRemaining: 6 });
  const dashain = computePayslip({
    basicSalary: 50000,
    employee: { ssfEnrolled: true },
    monthsRemaining: 6,
    includeFestival: true,
  });

  assert.equal(dashain.grossEarnings - normal.grossEarnings, 50000);
  assert.equal(dashain.earnings.find((e) => e.label === 'Festival expense').amount, 50000);

  // The bonus is a one-off: it must be added once to the annual projection, not
  // multiplied across the remaining months.
  assert.equal(
    dashain.tax.projectedAnnualIncome - normal.tax.projectedAnnualIncome,
    50000,
  );
});

test('payslip: the festival payment is pro-rated in the first year of service', () => {
  const asOf = new Date('2026-09-01');
  const joinedSixMonthsAgo = computePayslip({
    basicSalary: 60000,
    employee: { ssfEnrolled: true, joinedOn: new Date('2026-03-01') },
    includeFestival: true,
    asOf,
  });
  const festival = joinedSixMonthsAgo.earnings.find((e) => e.label === 'Festival expense');
  assert.equal(festival.amount, 30000); // six months of twelve
});

test('payslip: tax already withheld this year reduces what is taken now', () => {
  const fresh = computePayslip({
    basicSalary: 100000,
    employee: { ssfEnrolled: true },
    monthsRemaining: 12,
    taxPaidToDate: 0,
  });
  const partway = computePayslip({
    basicSalary: 100000,
    employee: { ssfEnrolled: true },
    monthsRemaining: 6,
    taxPaidToDate: fresh.tax.annualLiability / 2,
  });

  // Half the liability already paid, half the year left — the monthly figure
  // should land back on the same number rather than double-charging.
  assert.ok(Math.abs(partway.tax.thisMonth - fresh.tax.thisMonth) < 1);
});
