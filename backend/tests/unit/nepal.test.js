import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adToBs,
  bsToAd,
  formatBs,
  formatBsIso,
  parseBsString,
  daysInBsMonth,
  daysInBsYear,
  bsMonthGrid,
  bsMonthRange,
  fiscalYearOf,
  parseFiscalYearCode,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
  NEPAL_UTC_OFFSET_MINUTES,
  __selfCheck,
  formatNpr,
  amountInWords,
  parseNpr,
  roundPaisa,
  groupSouthAsian,
  toNepaliDigits,
  PROVINCES,
  DISTRICTS,
  districtsOfProvince,
  formatAddress,
  validateIdentifier,
  compositeKey,
  ID_TYPES,
  normalisePhone,
  isNepaliMobile,
  toE164,
  nameSkeletonKey,
  isHighFrequencySurname,
  estimateDobFromAge,
  preciseAge,
  formatAge,
} from '../../src/utils/nepal.js';

/** The Gregorian calendar date in Nepal for an instant, as yyyy-mm-dd. */
const nepalDay = (date) =>
  new Date(date.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);

/* ==========================================================================
 * BIKRAM SAMBAT
 * ======================================================================= */

test('BS: the month table passes its own structural self-check', () => {
  // Every BS year is 365 or 366 days. A typo in any row breaks this, including
  // in years no published anchor covers.
  assert.deepEqual(__selfCheck.verifyTable(), []);
});

test('BS: published Baisakh 1 dates convert exactly', () => {
  const anchors = [
    [2070, '2013-04-14'],
    [2073, '2016-04-13'],
    [2076, '2019-04-14'],
    [2080, '2023-04-14'],
    [2081, '2024-04-13'],
    [2082, '2025-04-14'],
  ];
  for (const [year, expected] of anchors) {
    assert.equal(nepalDay(bsToAd(year, 1, 1)), expected, `Baisakh 1, ${year} BS`);
  }
});

test('BS: fiscal year opens on Shrawan 1', () => {
  assert.equal(nepalDay(bsToAd(2081, 4, 1)), '2024-07-16');
});

test('BS: round-trips every month boundary across the operational range', () => {
  let checked = 0;
  for (let year = 2000; year <= 2095; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const last = daysInBsMonth(year, month);
      for (const day of [1, last]) {
        const back = adToBs(bsToAd(year, month, day));
        assert.deepEqual(
          { year: back.year, month: back.month, day: back.day },
          { year, month, day },
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 2000, 'expected a few thousand boundary checks');
});

test('BS: a BS date is Nepal-local, not UTC-local', () => {
  // 18:30 UTC is 00:15 the next day in Kathmandu. An admission logged then
  // belongs to the next BS day, and getting this wrong silently shortens
  // every month-end report.
  const before = adToBs(new Date('2026-08-16T18:00:00Z'));
  const after = adToBs(new Date('2026-08-16T18:30:00Z'));
  assert.equal(formatBsIso(before), '2083-04-31');
  assert.equal(formatBsIso(after), '2083-05-01');
});

test('BS: weekday matches the real Gregorian weekday', () => {
  // 13 April 2024 was a Saturday; Saturday is index 6.
  assert.equal(adToBs(new Date('2024-04-13T06:00:00Z')).weekday, 6);
});

test('BS: rejects dates outside the table rather than guessing', () => {
  assert.throws(() => bsToAd(MIN_BS_YEAR - 1, 1, 1), /outside the supported range/);
  assert.throws(() => bsToAd(MAX_BS_YEAR + 1, 1, 1), /outside the supported range/);
  assert.throws(() => adToBs(new Date('1800-01-01')), /outside the BS conversion table/);
});

test('BS: rejects a day that does not exist in its month', () => {
  const days = daysInBsMonth(2081, 9); // Poush 2081 is a short month
  assert.throws(() => bsToAd(2081, 9, days + 1), /not a valid BS date/);
  assert.equal(parseBsString(`2081-09-${days + 1}`), null);
});

test('BS: parses and formats the wire form', () => {
  assert.deepEqual(parseBsString('2081-04-15'), { year: 2081, month: 4, day: 15 });
  assert.deepEqual(parseBsString('2081/4/15'), { year: 2081, month: 4, day: 15 });
  assert.equal(parseBsString('not a date'), null);
  assert.equal(formatBs({ year: 2081, month: 4, day: 15 }, { locale: 'en' }), '15 Shrawan 2081');
  assert.equal(formatBs({ year: 2081, month: 4, day: 15 }, { locale: 'ne' }), '१५ साउन २०८१');
});

test('BS: month grid pads to whole weeks and holds every day once', () => {
  const grid = bsMonthGrid(2081, 4);
  assert.ok(grid.every((week) => week.length === 7));
  const days = grid.flat().filter((d) => d !== null);
  assert.deepEqual(days, Array.from({ length: daysInBsMonth(2081, 4) }, (_, i) => i + 1));
});

test('BS: month range is half-open and covers exactly the month', () => {
  const { start, end, days } = bsMonthRange(2081, 4);
  assert.equal(nepalDay(start), '2024-07-16');
  assert.equal(Math.round((end - start) / 86400000), days);
  // The end instant belongs to the next month, so a `$lt: end` query is right.
  assert.equal(adToBs(end).month, 5);
});

test('BS: fiscal year spans Shrawan 1 to the end of Ashadh', () => {
  const fy = fiscalYearOf(new Date('2024-09-01'));
  assert.equal(fy.code, '2081-82');
  assert.equal(fy.labelEn, '2081/82');
  assert.equal(nepalDay(fy.startsOn), '2024-07-16');
  assert.equal(adToBs(fy.endsOn).month, 3); // Ashadh
  assert.equal(adToBs(fy.endsOn).year, 2082);

  // A date in Baisakh belongs to the fiscal year that opened the previous July.
  assert.equal(fiscalYearOf(new Date('2024-05-01')).code, '2080-81');
  assert.deepEqual(parseFiscalYearCode('2081-82').startYear, 2081);
  assert.equal(parseFiscalYearCode('nonsense'), null);
});

test('BS: year lengths are only ever 365 or 366', () => {
  for (let year = MIN_BS_YEAR; year <= MAX_BS_YEAR; year += 1) {
    const length = daysInBsYear(year);
    assert.ok(length === 365 || length === 366, `BS ${year} has ${length} days`);
  }
});

/* ==========================================================================
 * MONEY
 * ======================================================================= */

test('NPR: groups digits the South Asian way', () => {
  assert.equal(groupSouthAsian(123), '123');
  assert.equal(groupSouthAsian(1234), '1,234');
  assert.equal(groupSouthAsian(123456), '1,23,456');
  assert.equal(groupSouthAsian(12345678), '1,23,45,678');
  assert.equal(formatNpr(1234567.89), 'Rs. 12,34,567.89');
  assert.equal(formatNpr(1234567.89, { locale: 'ne' }), 'रू १२,३४,५६७.८९');
});

test('NPR: rounds paisa half-up, and the carry reaches the rupee', () => {
  assert.equal(roundPaisa(1.005), 1.01);
  assert.equal(roundPaisa(2.675), 2.68);
  assert.equal(formatNpr(0.999), 'Rs. 1.00');
  assert.equal(formatNpr(-45.5), 'Rs. −45.50');
});

test('NPR: spells amounts in the lakh/crore system', () => {
  assert.equal(amountInWords(150000), 'Rupees One Lakh Fifty Thousand Only');
  assert.equal(
    amountInWords(1234567.89),
    'Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Eighty-Nine Paisa Only',
  );
  assert.equal(amountInWords(150000, { locale: 'ne' }), 'रुपैयाँ एक लाख पचास हजार मात्र');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
});

test('NPR: parses whatever a clerk types back into a number', () => {
  assert.equal(parseNpr('रू १२,३४,५६७.८९'), 1234567.89);
  assert.equal(parseNpr('Rs. 1,234.50'), 1234.5);
  assert.equal(parseNpr('1234'), 1234);
  assert.equal(parseNpr('abc'), null);
});

test('NPR: renders Devanagari numerals for display', () => {
  assert.equal(toNepaliDigits(2081), '२०८१');
});

/* ==========================================================================
 * ADDRESSES
 * ======================================================================= */

test('address: the federal structure is complete and consistent', () => {
  assert.equal(PROVINCES.length, 7);
  assert.equal(DISTRICTS.length, 77);
  const counted = PROVINCES.reduce((sum, p) => sum + districtsOfProvince(p.code).length, 0);
  assert.equal(counted, 77, 'every district belongs to exactly one province');

  const codes = new Set(DISTRICTS.map((d) => d.code));
  assert.equal(codes.size, 77, 'district codes are unique');
});

test('address: the split districts are modelled as separate districts', () => {
  // The 2017 restructuring split Nawalparasi and Rukum across provincial
  // boundaries. Treating either as one district misfiles half its patients.
  const names = DISTRICTS.map((d) => d.en);
  assert.ok(names.includes('Nawalpur') && names.includes('Parasi'));
  assert.ok(names.includes('Rukum East') && names.includes('Rukum West'));
  assert.notEqual(
    DISTRICTS.find((d) => d.en === 'Rukum East').province,
    DISTRICTS.find((d) => d.en === 'Rukum West').province,
  );
});

test('address: renders most-specific-first, the way an envelope reads', () => {
  const address = {
    districtCode: 'P3-D05',
    localLevelName: 'Kathmandu Metropolitan City',
    wardNo: 16,
    tole: 'Baneshwor',
  };
  assert.equal(
    formatAddress(address, { locale: 'en' }),
    'Baneshwor, Kathmandu Metropolitan City, Ward 16, Kathmandu',
  );
  assert.match(formatAddress({ ...address, localLevelName: 'काठमाडौं' }, { locale: 'ne' }), /१६/);
});

/* ==========================================================================
 * IDENTIFIERS
 * ======================================================================= */

test('identifiers: a citizenship number without its district is rejected', () => {
  // Numbers are issued per district, so the number alone is not an identity.
  // Accepting it would eventually merge two strangers' charts.
  const without = validateIdentifier({ type: ID_TYPES.CITIZENSHIP, value: '1234/567' });
  assert.equal(without.valid, false);
  assert.match(without.errors[0], /issuing district/);

  const withDistrict = validateIdentifier({
    type: ID_TYPES.CITIZENSHIP,
    value: '1234/567',
    issuingDistrict: 'P4-D03',
  });
  assert.equal(withDistrict.valid, true);
});

test('identifiers: the same number from two districts is two different people', () => {
  const kaski = compositeKey({ type: ID_TYPES.CITIZENSHIP, value: '1234/567', issuingDistrict: 'P4-D03' });
  const jhapa = compositeKey({ type: ID_TYPES.CITIZENSHIP, value: '1234/567', issuingDistrict: 'P1-D04' });
  assert.notEqual(kaski, jhapa);
});

test('identifiers: an unmatched-on identifier yields no key rather than a weak one', () => {
  assert.equal(compositeKey({ type: ID_TYPES.CITIZENSHIP, value: '1234/567' }), null);
  assert.equal(compositeKey({ type: ID_TYPES.NATIONAL_ID, value: '' }), null);
});

test('identifiers: validates the fixed-width national formats', () => {
  assert.equal(validateIdentifier({ type: ID_TYPES.NATIONAL_ID, value: '12345678901' }).valid, true);
  assert.equal(validateIdentifier({ type: ID_TYPES.NATIONAL_ID, value: '123' }).valid, false);
  assert.equal(validateIdentifier({ type: ID_TYPES.PAN, value: '123456789' }).valid, true);
  assert.equal(validateIdentifier({ type: ID_TYPES.PAN, value: '12345' }).valid, false);
});

/* ==========================================================================
 * PEOPLE
 * ======================================================================= */

test('phone: normalises every form a patient gives to the same digits', () => {
  for (const input of ['+977 9841-234567', '9841234567', '০৯', '098-41234567', '00977 9841234567']) {
    if (input === '০৯') continue;
    assert.equal(normalisePhone(input), '9841234567', input);
  }
  assert.equal(normalisePhone('०९८४१२३४५६७'), '9841234567', 'Devanagari digits');
  assert.equal(isNepaliMobile('9841234567'), true);
  assert.equal(isNepaliMobile('1234567890'), false);
  assert.equal(toE164('9841234567'), '+9779841234567');
});

test('names: romanisation variants collapse to one match key', () => {
  const families = [
    ['Shrestha', 'Shreshtha', 'श्रेष्ठ'],
    ['Bhattarai', 'Bhattrai', 'भट्टराई'],
    ['Paudel', 'Poudel', 'पौडेल'],
    ['Sabitri', 'Savitri'],
    ['Gurung', 'गुरुङ'],
    ['Tamang', 'तामाङ'],
  ];
  for (const family of families) {
    const keys = new Set(family.map(nameSkeletonKey));
    assert.equal(keys.size, 1, `${family.join(' / ')} produced ${[...keys].join(', ')}`);
  }
});

test('names: genuinely different names do not collide', () => {
  const pairs = [['Ram', 'Shyam'], ['Sita', 'Gita'], ['Karki', 'Khadka'], ['Rai', 'Rijal']];
  for (const [a, b] of pairs) {
    assert.notEqual(nameSkeletonKey(a), nameSkeletonKey(b), `${a} vs ${b}`);
  }
});

test('names: the very common surnames are flagged as low-signal', () => {
  // Matching on "Shrestha" alone would make every Shrestha in the district a
  // possible duplicate of every other, so the MPI must down-weight it.
  assert.equal(isHighFrequencySurname('Shrestha'), true);
  assert.equal(isHighFrequencySurname('श्रेष्ठ'), true);
  assert.equal(isHighFrequencySurname('Wickramasinghe'), false);
});

test('age: a stated age becomes an estimated DOB that reads back correctly', () => {
  const asOf = new Date('2026-08-16T06:00:00Z');
  const dob = estimateDobFromAge(65, 'years', asOf);
  assert.equal(preciseAge(dob, asOf).years, 65);
  assert.equal(formatAge(dob, { asOf, estimated: true }), '~65 yrs');
});

test('age: infants read in months and neonates in days', () => {
  const asOf = new Date('2026-08-16T06:00:00Z');
  assert.match(formatAge(estimateDobFromAge(3, 'months', asOf), { asOf }), /^3 mo/);
  assert.match(formatAge(estimateDobFromAge(10, 'days', asOf), { asOf }), /^10 days/);
});

test('age: a future date of birth is not an age', () => {
  assert.equal(preciseAge(new Date('2030-01-01'), new Date('2026-01-01')), null);
  assert.equal(formatAge(null), '—');
});
