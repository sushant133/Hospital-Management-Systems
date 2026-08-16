/**
 * Devanagari ⇄ Latin digits.
 *
 * Lives in its own module because both the calendar and the money formatter
 * need it. When each owned a private copy, `export *` from the barrel saw the
 * same name exported twice, treated it as ambiguous, and silently dropped it —
 * no error, the function simply ceased to exist for every importer.
 */

export const NEPALI_DIGITS = Object.freeze(['०', '१', '२', '३', '४', '५', '६', '७', '८', '९']);

/** Latin digits → Devanagari. Display only — never store these. */
export function toNepaliDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => NEPALI_DIGITS[Number(d)]);
}

/** Devanagari digits → Latin, so a user may type either into any field. */
export function fromNepaliDigits(value) {
  return String(value ?? '').replace(/[०-९]/g, (d) => String(NEPALI_DIGITS.indexOf(d)));
}

export default { toNepaliDigits, fromNepaliDigits, NEPALI_DIGITS };
