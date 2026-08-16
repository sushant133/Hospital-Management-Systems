/**
 * ============================================================================
 * NEPALI RUPEE — FORMATTING, GROUPING, AND AMOUNT IN WORDS
 * ============================================================================
 *
 * Two things make Nepali money different from the `Intl.NumberFormat` default,
 * and both show up on every printed bill.
 *
 * 1. GROUPING. South Asian numbering groups the last three digits, then twos:
 *    12,34,567.89 — not 1,234,567.89. Hospital bills are read aloud in lakhs
 *    ("एक लाख बीस हजार"), so Western grouping is actively confusing at the
 *    counter.
 *
 * 2. AMOUNT IN WORDS. An IRD-compliant invoice carries the total spelled out,
 *    and it is spelled in the lakh/crore system in both Nepali and English.
 *
 * We do NOT rely on `Intl` with an `en-IN` locale for this. A clinic PC may
 * have any locale installed, ICU data varies by Node build, and a bill that
 * silently changes its grouping between two machines is a compliance problem.
 * The grouping below is done by hand so it is identical everywhere.
 */

import { toNepaliDigits, fromNepaliDigits } from './digits.js';

export const CURRENCY_CODE = 'NPR';
export const CURRENCY_SYMBOL = 'रू';
export const CURRENCY_SYMBOL_EN = 'Rs.';

/** Money is stored in rupees as a float; paisa is the second decimal. */
export const PAISA_PER_RUPEE = 100;

/**
 * Round to paisa, half-up.
 *
 * Half-up rather than banker's rounding because that is what Nepali accounting
 * practice and every hand-written bill does — a patient checking the arithmetic
 * must reach the same number we did. Fixed at two decimals: `invoiceService`
 * and `payrollService` both route through here so no two modules can round
 * differently and leave the ledger off by a paisa.
 */
export function roundPaisa(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  // The +Number.EPSILON nudge stops 1.005 landing on 1.00 through float error.
  return Math.round((n + Number.EPSILON) * PAISA_PER_RUPEE) / PAISA_PER_RUPEE;
}

/** Split a rupee amount into whole rupees and whole paisa. */
export function splitPaisa(amount) {
  const rounded = roundPaisa(Math.abs(Number(amount) || 0));
  const rupees = Math.floor(rounded);
  const paisa = Math.round((rounded - rupees) * PAISA_PER_RUPEE);
  // Rounding up to exactly 100 paisa carries into the rupee.
  if (paisa === PAISA_PER_RUPEE) return { rupees: rupees + 1, paisa: 0 };
  return { rupees, paisa };
}

/**
 * South Asian digit grouping: last three, then pairs.
 * 1234567 -> "12,34,567"
 */
export function groupSouthAsian(integerPart) {
  const digits = String(integerPart).replace(/\D/g, '');
  if (digits.length <= 3) return digits;

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${grouped},${last3}`;
}

/**
 * Format an amount as NPR.
 *
 * @param {number} amount
 * @param {object} [options]
 * @param {'ne'|'en'} [options.locale='en']   'ne' renders Devanagari digits and रू
 * @param {boolean}   [options.symbol=true]   prepend the currency symbol
 * @param {boolean}   [options.decimals=true] show paisa
 * @param {boolean}   [options.signed=false]  always show + / −
 */
export function formatNpr(amount, options = {}) {
  const {
    locale = 'en',
    symbol = true,
    decimals = true,
    signed = false,
  } = options;

  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';

  const rounded = roundPaisa(n);
  const negative = rounded < 0;
  const { rupees, paisa } = splitPaisa(rounded);

  let body = groupSouthAsian(rupees);
  if (decimals) body += `.${String(paisa).padStart(2, '0')}`;

  const ne = locale === 'ne';
  if (ne) body = toNepaliDigits(body);

  const sign = negative ? '−' : signed ? '+' : '';
  if (!symbol) return `${sign}${body}`;

  // Sign goes *inside* the symbol — "Rs. −45.50", the way a refund line reads
  // on a Nepali bill. Putting it outside ("−Rs. 45.50") looks like the currency
  // itself is negated and reads wrong in a column of figures.
  const mark = ne ? CURRENCY_SYMBOL : CURRENCY_SYMBOL_EN;
  return `${mark} ${sign}${body}`;
}

/* ==========================================================================
 * AMOUNT IN WORDS
 * ==========================================================================
 * Required on the face of an IRD-compliant tax invoice. Written in the
 * lakh/crore system, which is why this cannot be delegated to a generic
 * English number-to-words routine.
 */

const EN_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const EN_TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

/**
 * Nepali has a distinct word for every number 0–99 — they are not composed
 * from tens and ones the way English builds "twenty-one". The full table is
 * the only correct way to render them.
 */
const NE_0_99 = [
  'शून्य', 'एक', 'दुई', 'तीन', 'चार', 'पाँच', 'छ', 'सात', 'आठ', 'नौ',
  'दश', 'एघार', 'बाह्र', 'तेह्र', 'चौध', 'पन्ध्र', 'सोह्र', 'सत्र', 'अठार', 'उन्नाइस',
  'बीस', 'एक्काइस', 'बाइस', 'तेइस', 'चौबिस', 'पच्चिस', 'छब्बिस', 'सत्ताइस', 'अठ्ठाइस', 'उनन्तिस',
  'तीस', 'एकतिस', 'बत्तिस', 'तेत्तिस', 'चौँतिस', 'पैँतिस', 'छत्तिस', 'सैँतिस', 'अठतिस', 'उनन्चालिस',
  'चालिस', 'एकचालिस', 'बयालिस', 'त्रिचालिस', 'चवालिस', 'पैँतालिस', 'छयालिस', 'सट्चालिस', 'अठचालिस', 'उनन्चास',
  'पचास', 'एकाउन्न', 'बाउन्न', 'त्रिपन्न', 'चवन्न', 'पचपन्न', 'छपन्न', 'सन्ताउन्न', 'अन्ठाउन्न', 'उनन्साठी',
  'साठी', 'एकसट्ठी', 'बयसट्ठी', 'त्रिसट्ठी', 'चौंसट्ठी', 'पैंसट्ठी', 'छयसट्ठी', 'सतसट्ठी', 'अठसट्ठी', 'उनन्सत्तरी',
  'सत्तरी', 'एकहत्तर', 'बहत्तर', 'त्रिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छयहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'असी', 'एकासी', 'बयासी', 'त्रियासी', 'चौरासी', 'पचासी', 'छयासी', 'सतासी', 'अठासी', 'उनान्नब्बे',
  'नब्बे', 'एकानब्बे', 'बयानब्बे', 'त्रियानब्बे', 'चौरानब्बे', 'पन्चानब्बे', 'छयानब्बे', 'सन्तानब्बे', 'अन्ठानब्बे', 'उनान्सय',
];

/** Scale words, largest first, in the South Asian system. */
const SCALES_EN = [
  [10000000, 'Crore'],
  [100000, 'Lakh'],
  [1000, 'Thousand'],
  [100, 'Hundred'],
];
const SCALES_NE = [
  [10000000, 'करोड'],
  [100000, 'लाख'],
  [1000, 'हजार'],
  [100, 'सय'],
];

function belowHundredEn(n) {
  if (n < 20) return EN_ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${EN_TENS[tens]}-${EN_ONES[ones]}` : EN_TENS[tens];
}

function wholeToWordsEn(value) {
  if (value === 0) return 'Zero';
  const parts = [];
  let rest = value;
  for (const [scale, word] of SCALES_EN) {
    if (rest >= scale) {
      const count = Math.floor(rest / scale);
      rest %= scale;
      // Counts above a crore recurse, so 12,34,56,78,900 still reads correctly.
      parts.push(`${count > 99 ? wholeToWordsEn(count) : belowHundredEn(count)} ${word}`);
    }
  }
  if (rest > 0) parts.push(belowHundredEn(rest));
  return parts.join(' ');
}

function wholeToWordsNe(value) {
  if (value === 0) return NE_0_99[0];
  const parts = [];
  let rest = value;
  for (const [scale, word] of SCALES_NE) {
    if (rest >= scale) {
      const count = Math.floor(rest / scale);
      rest %= scale;
      parts.push(`${count > 99 ? wholeToWordsNe(count) : NE_0_99[count]} ${word}`);
    }
  }
  if (rest > 0) parts.push(NE_0_99[rest]);
  return parts.join(' ');
}

/**
 * Spell an amount for the face of an invoice.
 *
 * English: "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred and Fifty Paisa Only"
 * Nepali:  "रुपैयाँ बाह्र लाख चौँतिस हजार पाँच सय पचास पैसा मात्र"
 */
export function amountInWords(amount, { locale = 'en' } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';

  const negative = n < 0;
  const { rupees, paisa } = splitPaisa(n);
  const ne = locale === 'ne';

  const rupeeWords = ne ? wholeToWordsNe(rupees) : wholeToWordsEn(rupees);
  const segments = [ne ? 'रुपैयाँ' : 'Rupees', rupeeWords];

  if (paisa > 0) {
    const paisaWords = ne ? NE_0_99[paisa] : belowHundredEn(paisa);
    segments.push(ne ? 'र' : 'and', paisaWords, ne ? 'पैसा' : 'Paisa');
  }

  segments.push(ne ? 'मात्र' : 'Only');
  const text = segments.join(' ');
  return negative ? `${ne ? 'ऋण' : 'Minus'} ${text}` : text;
}

/**
 * Parse user input back to a number. Accepts Devanagari digits, the currency
 * symbol, and grouping commas, so a receptionist can paste anything reasonable.
 */
export function parseNpr(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (!input) return null;
  const cleaned = fromNepaliDigits(String(input))
    .replace(/[रू]|Rs\.?|NPR/gi, '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export default {
  formatNpr,
  amountInWords,
  parseNpr,
  roundPaisa,
  splitPaisa,
  groupSouthAsian,
  toNepaliDigits,
  fromNepaliDigits,
  CURRENCY_CODE,
  CURRENCY_SYMBOL,
};
