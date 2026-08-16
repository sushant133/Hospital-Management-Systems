/**
 * ============================================================================
 * NEPALI NAMES, PHONE NUMBERS, AND AGE-WITHOUT-A-BIRTHDAY
 * ============================================================================
 *
 * Three registration-desk realities that a Western patient model gets wrong,
 * and that between them account for most bad data in a Nepali hospital's MPI.
 */

const NE_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

function toLatinDigits(value) {
  return String(value ?? '').replace(/[०-९]/g, (d) => String(NE_DIGITS.indexOf(d)));
}

/* ==========================================================================
 * PHONE NUMBERS
 * ==========================================================================
 * Nepali mobiles are ten digits beginning 97 or 98 (NTC, Ncell, Smart);
 * landlines are area code + 6–7 digits. The country code is +977. Patients
 * give the number a dozen different ways and the MPI matches on it, so
 * everything is normalised to bare national digits before storage.
 */

export const MOBILE_PREFIXES = Object.freeze(['97', '98']);

/** Strip +977 / 00977 / spaces / dashes down to national digits. */
export function normalisePhone(input) {
  if (!input) return '';
  let digits = toLatinDigits(input).replace(/[^\d+]/g, '');
  digits = digits.replace(/^\+?977/, '').replace(/^00977/, '');
  // A leading 0 is how landlines are dialled domestically; it is not part of
  // the number and would break matching against the same phone stored without.
  digits = digits.replace(/^0+/, '');
  return digits;
}

export function isNepaliMobile(input) {
  const digits = normalisePhone(input);
  return /^\d{10}$/.test(digits) && MOBILE_PREFIXES.includes(digits.slice(0, 2));
}

export function isNepaliLandline(input) {
  const digits = normalisePhone(input);
  // Area code (1–3 digits) + subscriber number; 7–9 digits total nationally.
  return /^\d{7,9}$/.test(digits) && !MOBILE_PREFIXES.includes(digits.slice(0, 2));
}

export function isValidNepaliPhone(input) {
  return isNepaliMobile(input) || isNepaliLandline(input);
}

/** Display form: "98XX-XXX-XXX" for mobiles, digits otherwise. */
export function formatPhone(input, { international = false } = {}) {
  const digits = normalisePhone(input);
  if (!digits) return '';
  const prefix = international ? '+977 ' : '';
  if (isNepaliMobile(digits)) {
    return `${prefix}${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return `${prefix}${digits}`;
}

/** E.164, which is what an SMS gateway wants. */
export function toE164(input) {
  const digits = normalisePhone(input);
  return digits ? `+977${digits}` : '';
}

/* ==========================================================================
 * NAMES
 * ==========================================================================
 * Nepali names are written in Devanagari as often as Latin, and the Latin
 * spelling is not standardised — Shrestha / Shreshtha / Schrestha are one
 * family. The MPI has to see through that, and a surname carries far less
 * discriminating power here than it does in a Western population: a handful of
 * surnames cover a large share of patients.
 */

/**
 * Surnames common enough that matching on them alone is close to meaningless.
 * The MPI down-weights a surname hit when the name is on this list — otherwise
 * every Shrestha in the district scores as a possible duplicate of every other.
 */
export const HIGH_FREQUENCY_SURNAMES = Object.freeze(new Set([
  'shrestha', 'thapa', 'magar', 'gurung', 'tamang', 'rai', 'limbu', 'sherpa',
  'karki', 'adhikari', 'poudel', 'paudel', 'bhattarai', 'khadka', 'basnet',
  'chaudhary', 'yadav', 'sah', 'mahato', 'kumar', 'devi', 'khatri', 'bista',
  'joshi', 'pandey', 'sharma', 'acharya', 'dahal', 'koirala', 'subedi',
  'nepali', 'bishwakarma', 'bk', 'pariyar', 'sunar', 'lama', 'ghale',
  'maharjan', 'dangol', 'shakya', 'bajracharya', 'tuladhar', 'singh', 'gautam',
  'regmi', 'aryal', 'timilsina', 'neupane', 'rijal', 'pokharel', 'lamichhane',
]));

/**
 * Devanagari → Latin, in the loose way Nepali names are actually romanised.
 * This is a *matching* transliteration, not a scholarly one: the goal is that
 * "श्रेष्ठ" and a clerk's "Shrestha" collapse to the same key.
 */
const DEVANAGARI_MAP = Object.freeze({
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'b', 'श': 's',
  'ष': 's', 'स': 's', 'ह': 'h', 'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'n', 'अः': 'h',
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ँ': 'n', 'ः': '', '्': '', '़': '',
});

/** Consonants carry an inherent 'a' unless a vowel sign or virama follows. */
// Codepoints, not literals: the nukta consonants (U+0958-U+095F) sort *after*
// the main block, so writing these as one literal range is a syntax error.
const DEVANAGARI_CONSONANTS = /[क-हक़-य़]/;
// Dependent vowel signs (matras); these cancel the inherent vowel.
const DEVANAGARI_VOWEL_SIGNS = /[ा-ौॢ-ॣ]/;
const VIRAMA = '्';

/**
 * Devanagari → Latin.
 *
 * The subtlety is the inherent vowel: भट्टराई is bh-a-ṭ-ṭ-a-r-ā-ī, not
 * "bhttrai". Every consonant implies a following 'a' unless a vowel sign or a
 * virama cancels it. Skipping that rule is what makes a naive transliterator
 * produce a key that matches nothing.
 */
export function transliterateDevanagari(input) {
  if (!input) return '';
  const text = String(input);
  let out = '';

  for (let i = 0; i < text.length; i += 1) {
    // Three-character conjuncts (क्ष, त्र, ज्ञ) must be tried before singles.
    const three = text.slice(i, i + 3);
    if (DEVANAGARI_MAP[three] !== undefined) {
      out += DEVANAGARI_MAP[three];
      i += 2;
      const after = text[i + 1];
      if (after !== VIRAMA && !DEVANAGARI_VOWEL_SIGNS.test(after || '')) out += 'a';
      continue;
    }

    const ch = text[i];
    const mapped = DEVANAGARI_MAP[ch];
    out += mapped !== undefined ? mapped : ch;

    if (DEVANAGARI_CONSONANTS.test(ch)) {
      const after = text[i + 1] || '';
      const cancelled = after === VIRAMA || DEVANAGARI_VOWEL_SIGNS.test(after);
      if (!cancelled) out += 'a';
    }
  }
  return out;
}

export function hasDevanagari(input) {
  return /[ऀ-ॿ]/.test(String(input ?? ''));
}

/**
 * Fold the spelling variants romanisation produces, so one family stops looking
 * like three: aspirates (bh/b, th/t), the s/sh and v/w/b confusions, ph/f, and
 * the au/ou wobble that makes Paudel and Poudel different words.
 *
 * Order matters — the digraphs must be folded before doubled letters collapse,
 * or "chh" becomes "ch" becomes something else entirely.
 */
function foldRomanisation(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents from any Latin input
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/chh|ch/g, 'c')
    .replace(/ph/g, 'f')
    .replace(/sh|ss/g, 's')
    .replace(/kh|ck/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/jh/g, 'j')
    .replace(/bh|v|w/g, 'b')
    .replace(/dh/g, 'd')
    .replace(/th/g, 't')
    .replace(/ou/g, 'au') // Poudel / Paudel
    .replace(/ng$/, 'n') // ङ romanises as both "n" and "ng": Gurung / गुरुङ
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/y(?=[aeiou])/g, 'i')
    .replace(/(.)\1+/g, '$1'); // collapse any remaining doubled letter
}

/**
 * The key a name is *scored* on — script-folded and spelling-folded, but with
 * vowels intact so it still discriminates between Ram and Rima.
 */
export function nameMatchKey(input) {
  if (!input) return '';
  const latin = hasDevanagari(input) ? transliterateDevanagari(input) : String(input);
  return foldRomanisation(latin).replace(/[aeiou]+$/, ''); // trailing vowels are least stable
}

/**
 * The key a name is *found* on — the consonant skeleton, vowels dropped after
 * the first letter.
 *
 * Vowels are the least reliable part of a romanised Nepali name (Sabitri /
 * Savitri / Sabithri), so the MPI narrows candidates on this loose key and then
 * scores them on the stricter one above. Recall first, precision second: a
 * duplicate the query never retrieves can never be caught by any amount of
 * clever scoring downstream.
 */
export function nameSkeletonKey(input) {
  if (!input) return '';
  const folded = nameMatchKey(input);
  if (!folded) return '';
  return (folded[0] + folded.slice(1).replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1');
}

/**
 * The high-frequency list, folded through the same key function the lookup uses.
 *
 * Built at load rather than written pre-folded, so the list above stays
 * readable as ordinary surnames. Comparing a folded query against an unfolded
 * list is the obvious way to get this silently wrong — every lookup returns
 * false and the MPI quietly loses its down-weighting.
 */
const HIGH_FREQUENCY_KEYS = new Set([...HIGH_FREQUENCY_SURNAMES].map((s) => nameMatchKey(s)));

/** True when a surname is too common to carry weight on its own. */
export function isHighFrequencySurname(surname) {
  const key = nameMatchKey(surname);
  return key !== '' && HIGH_FREQUENCY_KEYS.has(key);
}

/* ==========================================================================
 * AGE WITHOUT A DATE OF BIRTH
 * ==========================================================================
 * A large share of adult and elderly Nepali patients do not know their date of
 * birth and will state an age. Forcing a DOB makes staff type 01-01-1960, which
 * poisons the MPI (every such patient shares a birthday) and puts a false fact
 * on the chart.
 *
 * So the model records what the patient actually said — an age — and derives an
 * approximate DOB from it, flagged as estimated. `dobIsEstimated` is what tells
 * the MPI to down-weight the date and the UI to render "~65 years" rather than
 * a birthday.
 */

export const AGE_UNITS = Object.freeze(['years', 'months', 'days']);

/**
 * Derive an approximate date of birth from a stated age.
 *
 * Anchors to the *middle* of the implied range rather than the start: someone
 * who says "65" is anywhere in their 66th year, so mid-year is the lowest
 * expected error. For infants, months and days matter clinically (dosing), so
 * those are taken literally.
 */
export function estimateDobFromAge(age, unit = 'years', asOf = new Date()) {
  const n = Number(age);
  if (!Number.isFinite(n) || n < 0) return null;
  const base = new Date(asOf);
  if (Number.isNaN(base.getTime())) return null;

  const dob = new Date(base);
  if (unit === 'days') {
    dob.setDate(dob.getDate() - Math.round(n));
  } else if (unit === 'months') {
    dob.setMonth(dob.getMonth() - Math.round(n));
  } else {
    dob.setFullYear(dob.getFullYear() - Math.floor(n));
    // Step back a further six months to sit mid-range.
    dob.setMonth(dob.getMonth() - 6);
  }
  return dob;
}

/** Whole years / months / days between a DOB and now — the clinical form. */
export function preciseAge(dateOfBirth, asOf = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date(asOf);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(now.getTime())) return null;
  if (dob > now) return null;

  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  let days = now.getDate() - dob.getDate();

  if (days < 0) {
    months -= 1;
    // Days in the month that just ended, so "30 Jan → 1 Mar" counts correctly.
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/**
 * Age as a clinician expects to read it: years for adults, months for infants,
 * days for neonates — because that is what drives dosing decisions.
 */
export function formatAge(dateOfBirth, { asOf = new Date(), locale = 'en', estimated = false } = {}) {
  const age = preciseAge(dateOfBirth, asOf);
  if (!age) return '—';
  const ne = locale === 'ne';
  const approx = estimated ? '~' : '';

  if (age.years >= 2) return `${approx}${age.years} ${ne ? 'वर्ष' : 'yrs'}`;
  if (age.years === 1) {
    return `${approx}1 ${ne ? 'वर्ष' : 'yr'} ${age.months} ${ne ? 'महिना' : 'mo'}`;
  }
  if (age.months >= 1) {
    return `${approx}${age.months} ${ne ? 'महिना' : 'mo'} ${age.days} ${ne ? 'दिन' : 'd'}`;
  }
  return `${approx}${age.days} ${ne ? 'दिन' : 'days'}`;
}

export default {
  normalisePhone,
  isNepaliMobile,
  isValidNepaliPhone,
  formatPhone,
  toE164,
  transliterateDevanagari,
  hasDevanagari,
  nameMatchKey,
  nameSkeletonKey,
  isHighFrequencySurname,
  HIGH_FREQUENCY_SURNAMES,
  estimateDobFromAge,
  preciseAge,
  formatAge,
  AGE_UNITS,
};
