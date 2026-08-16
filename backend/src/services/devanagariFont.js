import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ============================================================================
 * DEVANAGARI IN GENERATED PDFs
 * ============================================================================
 *
 * PDFKit ships with the fourteen standard PDF fonts (Helvetica, Times,
 * Courier). None of them contains a single Devanagari glyph. Handed Nepali
 * text they do not error — they emit the glyph-not-found box, so a Nepali
 * invoice prints as a row of little rectangles and nobody finds out until a
 * patient is handed one.
 *
 * That silent failure is the whole reason this module exists. It:
 *   1. loads a real Devanagari face at startup,
 *   2. tells the caller plainly whether Nepali output is possible, and
 *   3. refuses to render Devanagari through a font that cannot show it.
 *
 * ---------------------------------------------------------------------------
 * THE FONT FILE IS NOT IN THIS REPOSITORY, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * Fonts carry licences. Rather than vendor a binary whose terms we cannot
 * assert for every deployment, the hospital supplies the file and points
 * `DEVANAGARI_FONT_PATH` at it. Noto Sans Devanagari (SIL Open Font Licence) is
 * the obvious choice and is redistributable; Mangal ships with Windows but is
 * NOT licensed for redistribution with an application.
 *
 * Drop the .ttf in `backend/assets/fonts/` and it is picked up automatically.
 *
 * ---------------------------------------------------------------------------
 * A LIMITATION WORTH KNOWING
 * ---------------------------------------------------------------------------
 * PDFKit's OpenType shaping handles Devanagari conjuncts and matra reordering
 * for most text, but complex stacked conjuncts can render imperfectly. Proof a
 * real invoice and a real payslip before going live — do not take a passing
 * unit test as evidence that the output is legible.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_FONT_DIR = path.resolve(here, '../../assets/fonts');

/** Filenames we look for, in preference order. */
const CANDIDATE_FILES = [
  'NotoSansDevanagari-Regular.ttf',
  'NotoSansDevanagari.ttf',
  'Mukta-Regular.ttf',
  'Kalimati.ttf',
  'Preeti.ttf',
];

const CANDIDATE_BOLD_FILES = [
  'NotoSansDevanagari-Bold.ttf',
  'Mukta-Bold.ttf',
];

/** PDFKit font names the rest of the codebase refers to. */
export const FONT_NAMES = Object.freeze({
  DEVANAGARI: 'Devanagari',
  DEVANAGARI_BOLD: 'Devanagari-Bold',
  LATIN: 'Helvetica',
  LATIN_BOLD: 'Helvetica-Bold',
});

function firstExisting(dir, filenames) {
  for (const filename of filenames) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Locate the Devanagari faces once, at module load.
 * `null` is a normal outcome on a fresh install; callers degrade to English.
 */
function locateFonts() {
  const explicit = process.env.DEVANAGARI_FONT_PATH;
  if (explicit && fs.existsSync(explicit)) {
    const boldGuess = explicit.replace(/-Regular\.ttf$/i, '-Bold.ttf');
    return {
      regular: explicit,
      bold: fs.existsSync(boldGuess) ? boldGuess : explicit,
    };
  }

  const regular = firstExisting(BUNDLED_FONT_DIR, CANDIDATE_FILES);
  if (!regular) return { regular: null, bold: null };

  const bold = firstExisting(BUNDLED_FONT_DIR, CANDIDATE_BOLD_FILES) || regular;
  return { regular, bold };
}

const FONTS = locateFonts();

/** True when Nepali text can actually be rendered into a PDF. */
export const devanagariAvailable = Boolean(FONTS.regular);

/**
 * Where the operator should put the file. Printed in the startup warning and
 * surfaced through the admin health check, so "why are my bills full of boxes"
 * has a findable answer.
 */
export const fontInstallHint =
  `Place a Devanagari TTF at ${path.join(BUNDLED_FONT_DIR, CANDIDATE_FILES[0])} ` +
  'or set DEVANAGARI_FONT_PATH. Noto Sans Devanagari (SIL OFL) is recommended.';

if (!devanagariAvailable) {
  // Warn loudly at boot rather than at the moment a patient is waiting for a
  // bill. A hospital that never intends to print Nepali can ignore it.
  console.warn(
    '[pdf] No Devanagari font found — Nepali PDFs will fall back to English.\n' +
      `      ${fontInstallHint}`,
  );
}

/**
 * Register the Devanagari faces on a PDFKit document.
 * Safe to call on every document; a no-op when no font is installed.
 */
export function registerFonts(doc) {
  if (!devanagariAvailable) return false;
  try {
    doc.registerFont(FONT_NAMES.DEVANAGARI, FONTS.regular);
    doc.registerFont(FONT_NAMES.DEVANAGARI_BOLD, FONTS.bold);
    return true;
  } catch (error) {
    console.error('[pdf] Devanagari font failed to register:', error.message);
    return false;
  }
}

const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/** Does this string need a Devanagari-capable face? */
export function needsDevanagari(text) {
  return DEVANAGARI_RANGE.test(String(text ?? ''));
}

/**
 * Choose the font for a run of text.
 *
 * The important case is the third one: Devanagari text with no font installed.
 * Returning Helvetica there would print boxes, so the caller is told the text
 * is unrenderable and can substitute the English equivalent instead — a bill
 * that reads in English is useful, a bill full of rectangles is not.
 */
export function fontFor(text, { bold = false } = {}) {
  if (!needsDevanagari(text)) {
    return { font: bold ? FONT_NAMES.LATIN_BOLD : FONT_NAMES.LATIN, renderable: true };
  }
  if (!devanagariAvailable) {
    return {
      font: bold ? FONT_NAMES.LATIN_BOLD : FONT_NAMES.LATIN,
      renderable: false,
      reason: 'No Devanagari font is installed on this server.',
    };
  }
  return {
    font: bold ? FONT_NAMES.DEVANAGARI_BOLD : FONT_NAMES.DEVANAGARI,
    renderable: true,
  };
}

/**
 * Write a run of text in the right face, falling back to a supplied English
 * string when Devanagari cannot be rendered.
 *
 * Every Nepali label in a generated document goes through here, which is what
 * makes "no font installed" degrade to a legible English bill rather than to
 * an unreadable one.
 */
export function writeText(doc, text, { fallback = '', bold = false, ...options } = {}) {
  const choice = fontFor(text, { bold });
  const output = choice.renderable ? text : fallback || text;

  // If we fell back, the output is Latin, so pick the Latin face for it.
  const font = choice.renderable ? choice.font : bold ? FONT_NAMES.LATIN_BOLD : FONT_NAMES.LATIN;

  doc.font(font).text(output, options);
  return choice.renderable;
}

/** Bilingual label: Nepali over English, or English alone when no font. */
export function bilingual(ne, en) {
  if (!ne) return en;
  if (!devanagariAvailable) return en;
  return `${ne} / ${en}`;
}

export default {
  registerFonts,
  fontFor,
  writeText,
  needsDevanagari,
  bilingual,
  devanagariAvailable,
  fontInstallHint,
  FONT_NAMES,
};
