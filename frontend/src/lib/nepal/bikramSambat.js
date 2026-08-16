/**
 * ============================================================================
 * BIKRAM SAMBAT ⇄ GREGORIAN
 * ============================================================================
 *
 * Nepal runs on Bikram Sambat. Every date a human reads or types in this system
 * is BS; every date we *store* stays Gregorian. This module is the only place
 * that knows how to cross between them.
 *
 * ---------------------------------------------------------------------------
 * WHY A LOOKUP TABLE AND NOT A FORMULA
 * ---------------------------------------------------------------------------
 * BS is a lunisolar-derived solar calendar whose month lengths (29–32 days) are
 * *published*, not computed — they are fixed each year by the Nepal Panchanga
 * Nirnayak Samiti. There is no closed-form conversion. Every correct
 * implementation carries the same table; ours runs 1970–2100 BS, which covers
 * AD 1913-04-13 through roughly AD 2044.
 *
 * ---------------------------------------------------------------------------
 * THE ANCHOR
 * ---------------------------------------------------------------------------
 * 1970-01-01 BS === 1913-04-13 AD. Everything is a day-offset from there, which
 * is why the table must be contiguous and must never be edited in the middle:
 * changing one year's month length shifts every later date.
 *
 * ---------------------------------------------------------------------------
 * TIME ZONES
 * ---------------------------------------------------------------------------
 * A BS date is a *calendar date in Nepal*, not an instant. Converting a stored
 * UTC timestamp means asking "what was the date in Kathmandu at that instant",
 * so every AD→BS entry point shifts into Nepal Time (UTC+05:45) first. Getting
 * this wrong makes late-evening admissions show the next day's date, which is
 * exactly the kind of bug nobody notices until a monthly report is short.
 */

import { toNepaliDigits, fromNepaliDigits } from './digits.js';

// Re-exported so a caller formatting a BS date gets the digit helpers from the
// same import rather than having to know they live in a sibling module.
export { toNepaliDigits, fromNepaliDigits };

/** Nepal Standard Time is UTC+05:45 and has no daylight saving. */
export const NEPAL_UTC_OFFSET_MINUTES = 345;

/** 1970-01-01 BS falls on this Gregorian date. */
const ANCHOR_BS_YEAR = 1970;
const ANCHOR_AD = Date.UTC(1913, 3, 13); // 1913-04-13

const MS_PER_DAY = 86400000;

export const BS_MONTHS_EN = Object.freeze([
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
]);

export const BS_MONTHS_NE = Object.freeze([
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कार्तिक', 'मंसिर', 'पुष', 'माघ', 'फागुन', 'चैत',
]);

export const BS_WEEKDAYS_EN = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

export const BS_WEEKDAYS_NE = Object.freeze([
  'आइतबार', 'सोमबार', 'मङ्गलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार',
]);

/** Short weekday labels for calendar grid headers. */
export const BS_WEEKDAYS_SHORT_NE = Object.freeze([
  'आइत', 'सोम', 'मङ्गल', 'बुध', 'बिही', 'शुक्र', 'शनि',
]);

/**
 * Days in each of the twelve months, indexed by BS year.
 *
 * DO NOT REORDER OR "CORRECT" A ROW without checking it against the official
 * Panchanga — the whole table is one running day-count from the anchor, so a
 * single wrong row silently shifts every date after it.
 */
const MONTH_DAYS = Object.freeze({
  1970: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1971: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  1972: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1973: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  1974: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1975: [31, 31, 32, 32, 30, 31, 30, 29, 30, 29, 30, 30],
  1976: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1977: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  1978: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1979: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  1980: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1981: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  1982: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1983: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  1984: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1985: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  1986: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1987: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  1988: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1989: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  1990: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  1991: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1992: [31, 31, 32, 31, 32, 30, 30, 30, 29, 30, 29, 30],
  1993: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1994: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  1995: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  1996: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  1997: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  1998: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  1999: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2000: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2001: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2002: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2003: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2004: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2005: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2006: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2007: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2008: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2009: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2010: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2011: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2012: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2013: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2014: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2015: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2016: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2017: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2018: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2019: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2020: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2021: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2022: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2023: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2024: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2025: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2026: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2027: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2028: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2029: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2030: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2031: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2032: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2033: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2034: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2035: [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2036: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2037: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2038: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2039: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2040: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2041: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2042: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2043: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2044: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2045: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2046: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2047: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2048: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2049: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2050: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2051: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2052: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2053: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2054: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2055: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2056: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2057: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2058: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2059: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2060: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2061: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2062: [30, 32, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31],
  2063: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2064: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2065: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2066: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2067: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2068: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2069: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2070: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2074: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2078: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2081: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2082: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2091: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2092: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2093: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2094: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2095: [31, 31, 32, 31, 31, 31, 30, 29, 30, 30, 30, 30],
  2096: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2097: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2098: [31, 31, 32, 31, 31, 31, 29, 30, 30, 30, 30, 30],
  2099: [31, 31, 32, 31, 31, 31, 30, 29, 30, 30, 30, 30],
  2100: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
});

export const MIN_BS_YEAR = ANCHOR_BS_YEAR;
export const MAX_BS_YEAR = 2100;

/**
 * Cumulative day count from the anchor to the first day of each BS year.
 * Built once at module load — the alternative is summing up to 130 rows on
 * every conversion, and conversions happen on every row of every list page.
 */
const YEAR_START_OFFSET = (() => {
  const offsets = new Map();
  let running = 0;
  for (let year = MIN_BS_YEAR; year <= MAX_BS_YEAR; year += 1) {
    offsets.set(year, running);
    running += MONTH_DAYS[year].reduce((sum, days) => sum + days, 0);
  }
  return offsets;
})();

/** Total days covered by the table — the bound for AD→BS lookups. */
const TOTAL_DAYS = (() => {
  const lastYearDays = MONTH_DAYS[MAX_BS_YEAR].reduce((sum, d) => sum + d, 0);
  return YEAR_START_OFFSET.get(MAX_BS_YEAR) + lastYearDays;
})();

export class BikramSambatRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BikramSambatRangeError';
    this.code = 'BS_OUT_OF_RANGE';
  }
}

/** Days in one BS month. Month is 1-based (1 = Baisakh). */
export function daysInBsMonth(year, month) {
  const row = MONTH_DAYS[year];
  if (!row) {
    throw new BikramSambatRangeError(
      `BS year ${year} is outside the supported range ${MIN_BS_YEAR}–${MAX_BS_YEAR}.`,
    );
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BikramSambatRangeError(`BS month must be 1–12, got ${month}.`);
  }
  return row[month - 1];
}

/** Days in a whole BS year — varies between 365 and 366. */
export function daysInBsYear(year) {
  const row = MONTH_DAYS[year];
  if (!row) {
    throw new BikramSambatRangeError(
      `BS year ${year} is outside the supported range ${MIN_BS_YEAR}–${MAX_BS_YEAR}.`,
    );
  }
  return row.reduce((sum, d) => sum + d, 0);
}

/** True when {year, month, day} names a real BS date. */
export function isValidBsDate(year, month, day) {
  try {
    return Number.isInteger(day) && day >= 1 && day <= daysInBsMonth(year, month);
  } catch {
    return false;
  }
}

/**
 * The Gregorian *calendar date in Nepal* for an instant.
 *
 * Returns a UTC-midnight Date whose Y/M/D are Kathmandu's, so date arithmetic
 * downstream is plain integer day maths with no DST or offset surprises.
 */
function toNepalCalendarDay(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * Gregorian → Bikram Sambat.
 *
 * Accepts a Date, an ISO string, or an epoch. Returns
 * `{ year, month, day, weekday }` with month 1-based and weekday 0=Sunday,
 * or null for an unparseable input.
 *
 * @throws {BikramSambatRangeError} when the date falls outside the table.
 */
export function adToBs(input) {
  const dayUtc = toNepalCalendarDay(input);
  if (dayUtc === null) return null;

  const offset = Math.round((dayUtc - ANCHOR_AD) / MS_PER_DAY);
  if (offset < 0 || offset >= TOTAL_DAYS) {
    throw new BikramSambatRangeError(
      `${new Date(dayUtc).toISOString().slice(0, 10)} is outside the BS conversion table ` +
        `(${MIN_BS_YEAR}–${MAX_BS_YEAR} BS).`,
    );
  }

  // Walk years from the anchor. At ~130 iterations worst case this is cheaper
  // than it looks, and the year-start map makes it a bounded scan.
  let year = MIN_BS_YEAR;
  while (year < MAX_BS_YEAR && YEAR_START_OFFSET.get(year + 1) <= offset) year += 1;

  let remaining = offset - YEAR_START_OFFSET.get(year);
  const months = MONTH_DAYS[year];
  let month = 1;
  while (remaining >= months[month - 1]) {
    remaining -= months[month - 1];
    month += 1;
  }

  // 1913-04-13 was a Sunday, so weekday is the offset mod 7 directly.
  const weekday = ((offset % 7) + 7) % 7;

  return { year, month, day: remaining + 1, weekday };
}

/**
 * Bikram Sambat → Gregorian.
 *
 * Returns a Date at **Nepal midnight** for that BS day, expressed as a real
 * instant (so 2081-04-01 BS becomes 2024-07-15T18:15:00Z). Storing this rather
 * than a naive UTC midnight is what keeps the round trip stable: convert it
 * back and you land on the same BS day regardless of the server's zone.
 *
 * @throws {BikramSambatRangeError} for a BS date that does not exist.
 */
export function bsToAd(year, month, day) {
  // Distinguish "that year is off our table" from "that day does not exist in
  // that month" — the first is a configuration problem the operator can act on,
  // the second is bad input. A single generic message sends people hunting in
  // the wrong place.
  if (!MONTH_DAYS[year]) {
    throw new BikramSambatRangeError(
      `BS year ${year} is outside the supported range ${MIN_BS_YEAR}–${MAX_BS_YEAR}.`,
    );
  }
  if (!isValidBsDate(year, month, day)) {
    throw new BikramSambatRangeError(`${year}-${month}-${day} is not a valid BS date.`);
  }

  let offset = YEAR_START_OFFSET.get(year);
  const months = MONTH_DAYS[year];
  for (let m = 1; m < month; m += 1) offset += months[m - 1];
  offset += day - 1;

  const nepalMidnightUtc = ANCHOR_AD + offset * MS_PER_DAY;
  return new Date(nepalMidnightUtc - NEPAL_UTC_OFFSET_MINUTES * 60000);
}

/** Today's date in Nepal, as BS. */
export function todayBs(now = new Date()) {
  return adToBs(now);
}

/**
 * Parse "2081-04-15" / "2081/04/15" (BS) into its parts.
 * Returns null when the string is malformed or names a non-existent day.
 */
export function parseBsString(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const parts = { year: Number(y), month: Number(m), day: Number(d) };
  return isValidBsDate(parts.year, parts.month, parts.day) ? parts : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** Canonical wire form for a BS date: "2081-04-15". */
export function formatBsIso(bs) {
  if (!bs) return '';
  return `${bs.year}-${pad(bs.month)}-${pad(bs.day)}`;
}


/**
 * Human-readable BS date.
 *
 * `locale: 'ne'` gives "१५ साउन २०८१"; `'en'` gives "15 Shrawan 2081".
 * `withWeekday` prepends the day name.
 */
export function formatBs(bs, { locale = 'ne', withWeekday = false, numeric = false } = {}) {
  if (!bs) return '';
  const ne = locale === 'ne';

  if (numeric) {
    const iso = formatBsIso(bs);
    return ne ? toNepaliDigits(iso) : iso;
  }

  const monthName = ne ? BS_MONTHS_NE[bs.month - 1] : BS_MONTHS_EN[bs.month - 1];
  const day = ne ? toNepaliDigits(bs.day) : String(bs.day);
  const year = ne ? toNepaliDigits(bs.year) : String(bs.year);
  const core = `${day} ${monthName} ${year}`;

  if (!withWeekday || bs.weekday === undefined) return core;
  const weekday = ne ? BS_WEEKDAYS_NE[bs.weekday] : BS_WEEKDAYS_EN[bs.weekday];
  return `${weekday}, ${core}`;
}

/** Convenience: an instant straight to a formatted BS string. */
export function formatAdAsBs(input, options) {
  const bs = adToBs(input);
  return bs ? formatBs(bs, options) : '';
}

/* ==========================================================================
 * FISCAL YEAR
 * ==========================================================================
 * Nepal's fiscal year runs Shrawan 1 → Ashadh end, i.e. BS months 4..12 of one
 * year plus 1..3 of the next. It is written "2081/82". Payroll, invoice
 * numbering, statutory returns and inventory year-end all key off this, so it
 * lives here beside the calendar rather than being re-derived per module.
 */

/** BS month that opens the fiscal year (Shrawan). */
export const FISCAL_YEAR_START_MONTH = 4;

/**
 * The fiscal year containing an instant.
 *
 * Returns `{ startYear, endYear, label, code, startsOn, endsOn }` where `code`
 * ("2081-82") is the machine-safe key to store, and `label` ("२०८१/८२") is what
 * a Nepali user expects to read.
 */
export function fiscalYearOf(input = new Date()) {
  const bs = adToBs(input);
  if (!bs) return null;
  const startYear = bs.month >= FISCAL_YEAR_START_MONTH ? bs.year : bs.year - 1;
  return fiscalYearFromStart(startYear);
}

/** Build the fiscal-year descriptor from its opening BS year. */
export function fiscalYearFromStart(startYear) {
  const endYear = startYear + 1;
  const lastMonthDays = daysInBsMonth(endYear, FISCAL_YEAR_START_MONTH - 1);
  return Object.freeze({
    startYear,
    endYear,
    /** "2081-82" — safe in ids, filenames and Mongo keys. */
    code: `${startYear}-${String(endYear).slice(-2)}`,
    /** "२०८१/८२" — what goes on a report header. */
    label: `${toNepaliDigits(startYear)}/${toNepaliDigits(String(endYear).slice(-2))}`,
    labelEn: `${startYear}/${String(endYear).slice(-2)}`,
    startsOn: bsToAd(startYear, FISCAL_YEAR_START_MONTH, 1),
    endsOn: bsToAd(endYear, FISCAL_YEAR_START_MONTH - 1, lastMonthDays),
  });
}

/** Parse a "2081-82" code back into a descriptor. */
export function parseFiscalYearCode(code) {
  const match = String(code || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (startYear < MIN_BS_YEAR || startYear >= MAX_BS_YEAR) return null;
  return fiscalYearFromStart(startYear);
}

/** The AD instants bounding one BS month — the range a monthly report scans. */
export function bsMonthRange(year, month) {
  const days = daysInBsMonth(year, month);
  const start = bsToAd(year, month, 1);
  // Exclusive end: Nepal-midnight opening the next day after the month's last.
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = nextYear <= MAX_BS_YEAR
    ? bsToAd(nextYear, nextMonth, 1)
    : new Date(bsToAd(year, month, days).getTime() + MS_PER_DAY);
  return { start, end, days };
}

/**
 * A month laid out as calendar-grid rows (Sunday-first), for a date picker.
 * `null` pads the leading and trailing cells.
 */
export function bsMonthGrid(year, month) {
  const days = daysInBsMonth(year, month);
  const firstWeekday = adToBs(bsToAd(year, month, 1)).weekday;

  const cells = Array(firstWeekday).fill(null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Shift a BS date by whole days, staying inside the table. */
export function addBsDays(bs, days) {
  return adToBs(new Date(bsToAd(bs.year, bs.month, bs.day).getTime() + days * MS_PER_DAY));
}

/* ==========================================================================
 * SELF-CHECK
 * ==========================================================================
 * The month table is transcribed data, and a single wrong row silently shifts
 * every later date — the worst kind of bug, because nothing throws and the
 * numbers merely become wrong. So we verify it at module load against dates
 * that are independently known, and refuse to start if any of them moved.
 *
 * Two classes of check:
 *   1. STRUCTURAL — every BS year must be 365 or 366 days. Catches a typo in
 *      any row, including years no anchor covers.
 *   2. ANCHORS — published Baisakh 1 dates plus the fiscal-year opening. These
 *      pin the cumulative offset, which is what a compensating pair of errors
 *      would otherwise hide.
 */

/** Baisakh 1 of each BS year, as its Gregorian date in Nepal. */
const ANCHORS = Object.freeze([
  [1970, 1, 1, '1913-04-13'], // the table's origin, true by definition
  [2000, 1, 1, '1943-04-14'],
  [2070, 1, 1, '2013-04-14'],
  [2073, 1, 1, '2016-04-13'],
  [2076, 1, 1, '2019-04-14'],
  [2080, 1, 1, '2023-04-14'],
  [2081, 1, 1, '2024-04-13'],
  [2081, 4, 1, '2024-07-16'], // FY 2081/82 opens on Shrawan 1
  [2082, 1, 1, '2025-04-14'],
]);

function verifyTable() {
  const problems = [];

  for (let year = MIN_BS_YEAR; year <= MAX_BS_YEAR; year += 1) {
    const length = daysInBsYear(year);
    if (length !== 365 && length !== 366) {
      problems.push(`BS ${year} has ${length} days; a BS year is 365 or 366.`);
    }
  }

  for (const [year, month, day, expected] of ANCHORS) {
    const nepalDay = new Date(
      bsToAd(year, month, day).getTime() + NEPAL_UTC_OFFSET_MINUTES * 60000,
    )
      .toISOString()
      .slice(0, 10);
    if (nepalDay !== expected) {
      problems.push(
        `BS ${year}-${pad(month)}-${pad(day)} converts to ${nepalDay}, expected ${expected}.`,
      );
    }
  }

  return problems;
}

const tableProblems = verifyTable();
if (tableProblems.length > 0) {
  throw new Error(
    `Bikram Sambat month table is inconsistent — every date in the system would be wrong:\n  - ${tableProblems.join('\n  - ')}`,
  );
}

/** Exposed so the test suite can assert the check itself still has teeth. */
export const __selfCheck = Object.freeze({ ANCHORS, verifyTable });

export default {
  adToBs,
  bsToAd,
  todayBs,
  formatBs,
  formatBsIso,
  formatAdAsBs,
  parseBsString,
  isValidBsDate,
  daysInBsMonth,
  daysInBsYear,
  bsMonthRange,
  bsMonthGrid,
  addBsDays,
  fiscalYearOf,
  fiscalYearFromStart,
  parseFiscalYearCode,
  toNepaliDigits,
  fromNepaliDigits,
  BS_MONTHS_EN,
  BS_MONTHS_NE,
  BS_WEEKDAYS_EN,
  BS_WEEKDAYS_NE,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
};
