/**
 * ============================================================================
 * NEPALI IDENTITY DOCUMENTS
 * ============================================================================
 *
 * A Nepali patient does not have "a national ID". They may hold a citizenship
 * certificate, a National ID card, a health-insurance membership, a PAN, a
 * disability card, a passport — several at once, none of them, or one belonging
 * to a family member. Modelling this as a single `nationalId` string throws away
 * the structure that duplicate detection, insurance eligibility and scheme
 * entitlement all depend on.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THAT MATTERS MOST: THE CITIZENSHIP NUMBER
 * ---------------------------------------------------------------------------
 * A citizenship certificate number is NOT unique on its own. Numbers are issued
 * per district, so "12345/678" from Kaski and "12345/678" from Jhapa are two
 * different people. The pair (number, issuing district) is the identity. Any
 * system that indexes the number alone will eventually merge two strangers'
 * charts — which is why `compositeKey` below always folds the district in.
 */

import { DISTRICT_CODES, getDistrict } from './administrative.js';

export const ID_TYPES = Object.freeze({
  CITIZENSHIP: 'citizenship',
  NATIONAL_ID: 'national_id',
  BIRTH_CERTIFICATE: 'birth_certificate',
  PASSPORT: 'passport',
  HEALTH_INSURANCE: 'health_insurance',
  DISABILITY_CARD: 'disability_card',
  SENIOR_CITIZEN_CARD: 'senior_citizen_card',
  PAN: 'pan',
  REFUGEE_ID: 'refugee_id',
  FOREIGN_ID: 'foreign_id',
});

export const ID_TYPE_VALUES = Object.freeze(Object.values(ID_TYPES));

export const ID_TYPE_LABELS = Object.freeze({
  [ID_TYPES.CITIZENSHIP]: { en: 'Citizenship certificate', ne: 'नागरिकता प्रमाणपत्र' },
  [ID_TYPES.NATIONAL_ID]: { en: 'National ID', ne: 'राष्ट्रिय परिचयपत्र' },
  [ID_TYPES.BIRTH_CERTIFICATE]: { en: 'Birth certificate', ne: 'जन्म दर्ता प्रमाणपत्र' },
  [ID_TYPES.PASSPORT]: { en: 'Passport', ne: 'राहदानी' },
  [ID_TYPES.HEALTH_INSURANCE]: { en: 'Health insurance ID', ne: 'स्वास्थ्य बीमा परिचय नं.' },
  [ID_TYPES.DISABILITY_CARD]: { en: 'Disability card', ne: 'अपाङ्गता परिचयपत्र' },
  [ID_TYPES.SENIOR_CITIZEN_CARD]: { en: 'Senior citizen card', ne: 'ज्येष्ठ नागरिक परिचयपत्र' },
  [ID_TYPES.PAN]: { en: 'PAN', ne: 'स्थायी लेखा नम्बर' },
  [ID_TYPES.REFUGEE_ID]: { en: 'Refugee ID', ne: 'शरणार्थी परिचयपत्र' },
  [ID_TYPES.FOREIGN_ID]: { en: 'Foreign national ID', ne: 'विदेशी परिचयपत्र' },
});

/** Types whose number only identifies a person together with a district. */
export const DISTRICT_SCOPED_TYPES = Object.freeze([
  ID_TYPES.CITIZENSHIP,
  ID_TYPES.BIRTH_CERTIFICATE,
]);

/**
 * Disability card categories under Nepal's disability rights framework.
 * They drive entitlement: Ka and Kha carry full free care at public facilities.
 */
export const DISABILITY_CATEGORIES = Object.freeze({
  KA: 'ka', // Red  — complete disability
  KHA: 'kha', // Blue — severe disability
  GA: 'ga', // Yellow — moderate disability
  GHA: 'gha', // White — general disability
});

export const DISABILITY_CATEGORY_LABELS = Object.freeze({
  [DISABILITY_CATEGORIES.KA]: { en: 'Ka (Red) — complete', ne: 'क (रातो) — पूर्ण अशक्त' },
  [DISABILITY_CATEGORIES.KHA]: { en: 'Kha (Blue) — severe', ne: 'ख (नीलो) — अति अशक्त' },
  [DISABILITY_CATEGORIES.GA]: { en: 'Ga (Yellow) — moderate', ne: 'ग (पहेँलो) — मध्यम' },
  [DISABILITY_CATEGORIES.GHA]: { en: 'Gha (White) — general', ne: 'घ (सेतो) — सामान्य' },
});

/** Strip spaces and normalise separators before comparing or storing. */
export function normaliseIdValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[–—]/g, '-')
    .toUpperCase();
}

/**
 * Per-type format rules.
 *
 * Deliberately permissive. Nepali documents have been issued in several formats
 * over decades and a hand-written certificate from the 1990s will not match a
 * modern pattern — rejecting it would block a real patient at the registration
 * desk. These catch typos, not forgeries.
 */
const FORMATS = Object.freeze({
  // "12-34-56-78901" or "1234/567" or plain digits — all seen in the wild.
  [ID_TYPES.CITIZENSHIP]: {
    pattern: /^[0-9][0-9-/]{3,24}$/,
    message: 'Citizenship number should be digits, optionally separated by - or /.',
  },
  // The National ID card number is an 11-digit numeric.
  [ID_TYPES.NATIONAL_ID]: {
    pattern: /^\d{11}$/,
    message: 'National ID must be 11 digits.',
  },
  [ID_TYPES.PASSPORT]: {
    pattern: /^[A-Z0-9]{6,12}$/,
    message: 'Passport number must be 6–12 letters or digits.',
  },
  // PAN is a 9-digit number issued by the IRD.
  [ID_TYPES.PAN]: {
    pattern: /^\d{9}$/,
    message: 'PAN must be 9 digits.',
  },
  [ID_TYPES.HEALTH_INSURANCE]: {
    pattern: /^[A-Z0-9-]{6,20}$/,
    message: 'Health insurance ID must be 6–20 letters, digits or hyphens.',
  },
});

/**
 * Validate one identifier.
 * Returns `{ valid, errors: string[] }` — never throws, because this runs
 * against half-typed input on a live form.
 */
export function validateIdentifier(identifier) {
  const errors = [];
  if (!identifier || typeof identifier !== 'object') {
    return { valid: false, errors: ['Identifier is missing.'] };
  }

  const { type, value, issuingDistrict } = identifier;

  if (!ID_TYPE_VALUES.includes(type)) {
    errors.push(`"${type}" is not a recognised identity document type.`);
    return { valid: false, errors };
  }

  const normalised = normaliseIdValue(value);
  if (!normalised) {
    errors.push(`${ID_TYPE_LABELS[type].en} number is required.`);
  } else {
    const rule = FORMATS[type];
    if (rule && !rule.pattern.test(normalised)) errors.push(rule.message);
  }

  if (DISTRICT_SCOPED_TYPES.includes(type)) {
    if (!issuingDistrict) {
      errors.push(
        `${ID_TYPE_LABELS[type].en} needs its issuing district — the number alone is not unique.`,
      );
    } else if (!DISTRICT_CODES.includes(issuingDistrict)) {
      errors.push(`"${issuingDistrict}" is not a Nepali district code.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * The key an identifier should be matched on.
 *
 * For district-scoped documents this folds in the district, so the MPI compares
 * "citizenship 1234/567 issued in Kaski" against the same thing and not merely
 * against the digits. Returns null when the identifier is too incomplete to
 * match on, which the MPI reads as "no signal" rather than "no match".
 */
export function compositeKey(identifier) {
  if (!identifier?.type) return null;
  const value = normaliseIdValue(identifier.value);
  if (!value) return null;

  if (DISTRICT_SCOPED_TYPES.includes(identifier.type)) {
    if (!identifier.issuingDistrict) return null;
    return `${identifier.type}:${identifier.issuingDistrict}:${value}`;
  }
  return `${identifier.type}:${value}`;
}

/** Pull one identifier of a given type out of a patient's list. */
export function findIdentifier(identifiers, type) {
  if (!Array.isArray(identifiers)) return null;
  return identifiers.find((id) => id?.type === type) || null;
}

/** Human-readable form for a bill or a report: "Citizenship 1234/567 (Kaski)". */
export function formatIdentifier(identifier, { locale = 'en' } = {}) {
  if (!identifier?.type) return '';
  const label = ID_TYPE_LABELS[identifier.type]?.[locale] || identifier.type;
  const value = normaliseIdValue(identifier.value);
  const district = identifier.issuingDistrict ? getDistrict(identifier.issuingDistrict) : null;
  const suffix = district ? ` (${locale === 'ne' ? district.ne : district.en})` : '';
  return `${label} ${value}${suffix}`;
}

export default {
  ID_TYPES,
  ID_TYPE_VALUES,
  ID_TYPE_LABELS,
  DISTRICT_SCOPED_TYPES,
  DISABILITY_CATEGORIES,
  DISABILITY_CATEGORY_LABELS,
  validateIdentifier,
  compositeKey,
  findIdentifier,
  formatIdentifier,
  normaliseIdValue,
};
