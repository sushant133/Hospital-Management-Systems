import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkAllergies,
  checkDoseRanges,
  checkWeightBasedDosing,
  checkDuplicateTherapy,
  checkRenalDosing,
  checkPregnancy,
  creatinineClearance,
  parseFrequencyPerDay,
  SEVERITY,
  REQUIRES_OVERRIDE_REASON,
} from '../../src/services/safetyService.js';

/**
 * B3 — medication safety.
 *
 * These are patient-harm paths, so each test states the clinical scenario it
 * represents rather than only the mechanics. A regression here is not a broken
 * report; it is a dose that should have been stopped and was not.
 */

/* ==========================================================================
 * ALLERGY — the check that did not exist before
 * ======================================================================= */

test('allergy: a penicillin allergy stops amoxicillin', () => {
  // The case that matters most, and the one a generic-name match cannot catch:
  // amoxicillin shares no name with "penicillin". Class matching is what works.
  const warnings = checkAllergies({
    drugs: [
      { _id: 'd1', name: 'Amoxicillin 500mg', genericName: 'amoxicillin', allergenClasses: ['penicillin', 'beta-lactam'] },
    ],
    allergies: [{ substance: 'Penicillin', severity: 'severe', reaction: 'anaphylaxis' }],
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].matchedOn, 'drug class');
  // A recorded SEVERE allergy is a contraindication, not a warning to scroll past.
  assert.equal(warnings[0].severity, SEVERITY.CONTRAINDICATED);
  assert.ok(REQUIRES_OVERRIDE_REASON.includes(warnings[0].severity));
});

test('allergy: an exact generic match is caught', () => {
  const warnings = checkAllergies({
    drugs: [{ _id: 'd1', name: 'Brufen', genericName: 'ibuprofen', allergenClasses: [] }],
    allergies: [{ substance: 'ibuprofen', severity: 'moderate' }],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].matchedOn, 'generic name');
  assert.equal(warnings[0].severity, SEVERITY.SEVERE);
});

test('allergy: an unrelated drug produces no warning', () => {
  const warnings = checkAllergies({
    drugs: [{ _id: 'd1', name: 'Paracetamol', genericName: 'paracetamol', allergenClasses: [] }],
    allergies: [{ substance: 'Penicillin', severity: 'severe' }],
  });
  assert.deepEqual(warnings, []);
});

test('allergy: a patient with no recorded allergies is not blocked', () => {
  const warnings = checkAllergies({
    drugs: [{ _id: 'd1', name: 'Amoxicillin', genericName: 'amoxicillin', allergenClasses: ['penicillin'] }],
    allergies: [],
  });
  assert.deepEqual(warnings, []);
});

/* ==========================================================================
 * DAILY TOTALS — the bug class the old check missed entirely
 * ======================================================================= */

test('frequency: the abbreviations on a Nepali drug chart parse', () => {
  assert.equal(parseFrequencyPerDay('OD'), 1);
  assert.equal(parseFrequencyPerDay('BD'), 2);
  assert.equal(parseFrequencyPerDay('TDS'), 3);
  assert.equal(parseFrequencyPerDay('QID'), 4);
  assert.equal(parseFrequencyPerDay('q8h'), 3);
  assert.equal(parseFrequencyPerDay('every 6 hours'), 4);
  // Unrecognised must be null, not a guess — a wrong multiplier is worse than none.
  assert.equal(parseFrequencyPerDay('as directed by mother'), null);
});

test('dose: the daily TOTAL is compared, not a single dose', () => {
  const drug = { _id: 'd1', name: 'Paracetamol 500mg', maxDailyDose: 4000, doseUnit: 'mg' };

  // 1000mg four times a day is 4000/day — at the limit, allowed.
  assert.deepEqual(
    checkDoseRanges({ drugs: [drug], items: [{ drugId: 'd1', dosage: '1000 mg', frequency: 'QID' }] }),
    [],
  );

  // 1500mg four times a day is 6000/day — hepatotoxic, and every individual
  // dose is under the daily maximum. Comparing a single dose would pass this.
  const over = checkDoseRanges({
    drugs: [drug],
    items: [{ drugId: 'd1', dosage: '1500 mg', frequency: 'QID' }],
  });
  assert.equal(over.length, 1);
  assert.equal(over[0].dailyTotal, 6000);
  assert.equal(over[0].severity, SEVERITY.SEVERE);
});

test('dose: a grossly excessive total is a contraindication, not a warning', () => {
  const over = checkDoseRanges({
    drugs: [{ _id: 'd1', name: 'Paracetamol', maxDailyDose: 4000, doseUnit: 'mg' }],
    items: [{ drugId: 'd1', dosage: '4000 mg', frequency: 'QID' }], // 16000/day
  });
  assert.equal(over[0].severity, SEVERITY.CONTRAINDICATED);
});

/* ==========================================================================
 * PAEDIATRIC WEIGHT DOSING
 * ======================================================================= */

test('paediatric: mg/kg/day above the maximum is caught', () => {
  const warnings = checkWeightBasedDosing({
    drugs: [{ _id: 'd1', name: 'Gentamicin', maxDosePerKg: 7.5, doseUnit: 'mg' }],
    items: [{ drugId: 'd1', dosage: '60 mg', frequency: 'TDS' }], // 180/day
    weightKg: 12,
    ageYears: 3,
  });
  // 180 / 12 = 15 mg/kg/day against a maximum of 7.5 — double, so contraindicated.
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].perKgPerDay, 15);
  assert.equal(warnings[0].severity, SEVERITY.CONTRAINDICATED);
});

test('paediatric: a missing weight is flagged for a child, not for an adult', () => {
  const drugs = [{ _id: 'd1', name: 'Gentamicin', maxDosePerKg: 7.5 }];

  const child = checkWeightBasedDosing({ drugs, items: [], weightKg: null, ageYears: 4 });
  assert.equal(child.length, 1);
  assert.equal(child[0].kind, 'weight-missing');

  // An adult dose is not weight-based, so a missing weight is not a safety issue.
  const adult = checkWeightBasedDosing({ drugs, items: [], weightKg: null, ageYears: 40 });
  assert.deepEqual(adult, []);
});

/* ==========================================================================
 * RENAL DOSING
 * ======================================================================= */

test('renal: Cockcroft-Gault applies the female factor', () => {
  const male = creatinineClearance({ ageYears: 70, weightKg: 60, serumCreatinineMgDl: 2, sex: 'male' });
  const female = creatinineClearance({ ageYears: 70, weightKg: 60, serumCreatinineMgDl: 2, sex: 'female' });
  assert.equal(male, 29.2);
  assert.equal(female, 24.8); // 0.85 x male
  // Missing inputs must yield null rather than a plausible-looking number.
  assert.equal(creatinineClearance({ ageYears: 70, weightKg: null, serumCreatinineMgDl: 2 }), null);
});

test('renal: a matching band gives the adjustment, and contraindication blocks', () => {
  const drug = {
    _id: 'd1',
    name: 'Metformin',
    renallyCleared: true,
    renalAdjustment: [
      { minClearance: 30, maxClearance: 45, recommendation: 'Halve the dose', contraindicated: false },
      { minClearance: 0, maxClearance: 30, recommendation: 'Do not use', contraindicated: true },
    ],
  };

  const reduced = checkRenalDosing({ drugs: [drug], creatinineClearanceMlMin: 35, hasCreatinine: true });
  assert.equal(reduced[0].severity, SEVERITY.SEVERE);
  assert.match(reduced[0].message, /Halve the dose/);

  const blocked = checkRenalDosing({ drugs: [drug], creatinineClearanceMlMin: 20, hasCreatinine: true });
  assert.equal(blocked[0].severity, SEVERITY.CONTRAINDICATED);
});

test('renal: no recent creatinine is itself worth saying', () => {
  // Prescribing a renally cleared drug blind is a decision; it should be a
  // conscious one rather than silence.
  const warnings = checkRenalDosing({
    drugs: [{ _id: 'd1', name: 'Vancomycin', renallyCleared: true }],
    creatinineClearanceMlMin: null,
    hasCreatinine: false,
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'renal-unknown');
});

/* ==========================================================================
 * DUPLICATES AND PREGNANCY
 * ======================================================================= */

test('duplicate: the same generic prescribed twice is caught across prescriptions', () => {
  // The realistic case: the ward prescribed it, the consultant prescribed it
  // again, and nobody saw both lists.
  const warnings = checkDuplicateTherapy({
    drugs: [{ _id: 'a', name: 'Calpol', genericName: 'paracetamol' }],
    activeDrugs: [{ _id: 'b', name: 'Paracip', genericName: 'paracetamol' }],
  });
  const generic = warnings.find((w) => w.kind === 'duplicate-generic');
  assert.ok(generic);
  assert.equal(generic.severity, SEVERITY.SEVERE);
});

test('duplicate: two drugs of one class are flagged', () => {
  const warnings = checkDuplicateTherapy({
    drugs: [{ _id: 'a', name: 'Brufen', genericName: 'ibuprofen', therapeuticClasses: ['NSAID'] }],
    activeDrugs: [{ _id: 'b', name: 'Naprosyn', genericName: 'naproxen', therapeuticClasses: ['NSAID'] }],
  });
  assert.ok(warnings.some((w) => w.kind === 'duplicate-class'));
});

test('pregnancy: category X is contraindicated, D is a severe warning', () => {
  const x = checkPregnancy({
    drugs: [{ _id: 'd1', name: 'Isotretinoin', pregnancyCategory: 'X' }],
    isPregnant: true,
  });
  assert.equal(x[0].severity, SEVERITY.CONTRAINDICATED);

  const d = checkPregnancy({
    drugs: [{ _id: 'd2', name: 'Phenytoin', pregnancyCategory: 'D' }],
    isPregnant: true,
  });
  assert.equal(d[0].severity, SEVERITY.SEVERE);

  // Not pregnant: no warning at all.
  assert.deepEqual(
    checkPregnancy({ drugs: [{ _id: 'd1', pregnancyCategory: 'X', name: 'Isotretinoin' }], isPregnant: false }),
    [],
  );
});

test('severity: only the dangerous levels demand a typed override reason', () => {
  // A warning everyone dismisses reflexively trains the dismissal, so the
  // trivial ones must not require ceremony.
  assert.ok(REQUIRES_OVERRIDE_REASON.includes(SEVERITY.CONTRAINDICATED));
  assert.ok(REQUIRES_OVERRIDE_REASON.includes(SEVERITY.SEVERE));
  assert.ok(!REQUIRES_OVERRIDE_REASON.includes(SEVERITY.MODERATE));
  assert.ok(!REQUIRES_OVERRIDE_REASON.includes(SEVERITY.MILD));
});
