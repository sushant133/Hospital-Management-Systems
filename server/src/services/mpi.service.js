import Patient from '../models/Patient.js';
import { escapeRegex } from '../utils/queryHelpers.js';

/**
 * Master Patient Index — duplicate detection.
 *
 * The single most expensive data-quality failure in a hospital system is the
 * same human being registered twice: their allergies sit on one chart and their
 * prescription on the other. This module makes that hard to do by accident,
 * while still allowing it deliberately (twins, shared phone numbers, genuine
 * namesakes) through an audited override.
 *
 * Deliberately NOT a stored "possibleDuplicates" field. Duplicate likelihood is
 * derived from data that changes — a phone number correction can create or
 * dissolve a match — so it is computed on demand and never cached.
 */

/**
 * Field weights, summing to more than 100 so that several medium signals can
 * combine into a confident match. Tuned so that:
 *   - a national ID match alone is definitive,
 *   - name + date of birth + phone lands above BLOCK,
 *   - name + date of birth alone lands in WARN (common enough to need eyes).
 */
const WEIGHTS = Object.freeze({
  nationalId: 100,
  phone: 35,
  email: 25,
  dateOfBirth: 25,
  lastNameExact: 20,
  lastNameFuzzy: 10,
  firstNameExact: 15,
  firstNameFuzzy: 7,
  gender: 5,
});

export const MPI_THRESHOLDS = Object.freeze({
  /** At or above this, registration is refused unless explicitly overridden. */
  BLOCK: 70,
  /** At or above this, the record is surfaced as a possible match. */
  WARN: 40,
});

/** Strip punctuation, casing and accents so "O'Brien" matches "obrien". */
function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Keep digits only, so "+1 (555) 010-9999" matches "5550109999". */
function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '');
}

/** Compare the last 9 digits — tolerates country-code and trunk-prefix variation. */
function phonesMatch(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (left.length < 6 || right.length < 6) return false;
  return left.slice(-9) === right.slice(-9);
}

function sameDay(a, b) {
  if (!a || !b) return false;
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.valueOf()) || Number.isNaN(right.valueOf())) return false;
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

/**
 * Levenshtein distance, capped: we only ever care whether it is ≤ 2, so the
 * loop bails out as soon as the best possible distance exceeds `max`.
 */
export function editDistance(a = '', b = '', max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      rowBest = Math.min(rowBest, current[j]);
    }

    if (rowBest > max) return max + 1;
    previous = current;
  }

  return previous[b.length];
}

/** Near-miss names: typos and transpositions, not merely similar names. */
function namesAreClose(a, b) {
  if (!a || !b) return false;
  const threshold = Math.min(a.length, b.length) <= 4 ? 1 : 2;
  return editDistance(a, b, threshold) <= threshold;
}

/**
 * Narrow the collection down before scoring.
 *
 * Scoring every patient in the hospital on every registration does not scale,
 * so candidates must share at least one indexed signal: national ID, phone,
 * email, date of birth, or a last name with the same first three letters. A
 * duplicate that shares none of those is not detectable by this approach — the
 * accepted blind spot is documented in ARCHITECTURE.md §3.
 */
function buildCandidateFilter({ nationalId, phone, email, dateOfBirth, lastName }) {
  const clauses = [];

  if (nationalId) clauses.push({ nationalId: String(nationalId).trim() });
  if (email) clauses.push({ email: String(email).trim().toLowerCase() });

  if (phone) {
    const digits = normalizePhone(phone).slice(-9);
    // Anchored to the end so an index-free regex still only scans phone values.
    if (digits.length >= 6) clauses.push({ phone: new RegExp(`${escapeRegex(digits)}$`) });
  }

  if (dateOfBirth) {
    const day = new Date(dateOfBirth);
    if (!Number.isNaN(day.valueOf())) {
      const start = new Date(day);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      clauses.push({ dateOfBirth: { $gte: start, $lt: end } });
    }
  }

  const lastNamePrefix = normalizeName(lastName).slice(0, 3);
  if (lastNamePrefix.length === 3) {
    clauses.push({ lastName: new RegExp(`^${escapeRegex(lastNamePrefix)}`, 'i') });
  }

  return clauses.length > 0 ? { $or: clauses } : null;
}

/** Score one existing record against the candidate, explaining every point. */
function scoreAgainst(candidate, existing) {
  let score = 0;
  const matchedOn = [];

  if (
    candidate.nationalId &&
    existing.nationalId &&
    String(candidate.nationalId).trim() === String(existing.nationalId).trim()
  ) {
    score += WEIGHTS.nationalId;
    matchedOn.push('nationalId');
  }

  if (phonesMatch(candidate.phone, existing.phone)) {
    score += WEIGHTS.phone;
    matchedOn.push('phone');
  }

  if (
    candidate.email &&
    existing.email &&
    candidate.email.trim().toLowerCase() === existing.email.trim().toLowerCase()
  ) {
    score += WEIGHTS.email;
    matchedOn.push('email');
  }

  if (sameDay(candidate.dateOfBirth, existing.dateOfBirth)) {
    score += WEIGHTS.dateOfBirth;
    matchedOn.push('dateOfBirth');
  }

  const candidateLast = normalizeName(candidate.lastName);
  const existingLast = normalizeName(existing.lastName);
  if (candidateLast && candidateLast === existingLast) {
    score += WEIGHTS.lastNameExact;
    matchedOn.push('lastName');
  } else if (namesAreClose(candidateLast, existingLast)) {
    score += WEIGHTS.lastNameFuzzy;
    matchedOn.push('lastName (similar)');
  }

  const candidateFirst = normalizeName(candidate.firstName);
  const existingFirst = normalizeName(existing.firstName);
  if (candidateFirst && candidateFirst === existingFirst) {
    score += WEIGHTS.firstNameExact;
    matchedOn.push('firstName');
  } else if (namesAreClose(candidateFirst, existingFirst)) {
    score += WEIGHTS.firstNameFuzzy;
    matchedOn.push('firstName (similar)');
  }

  if (candidate.gender && existing.gender && candidate.gender === existing.gender) {
    score += WEIGHTS.gender;
    matchedOn.push('gender');
  }

  return { score: Math.min(100, score), matchedOn };
}

/**
 * Find records that may already describe this person.
 *
 * Returns matches at or above WARN, strongest first, each with the score and
 * the fields that produced it — the receptionist sees *why* two records look
 * alike, which is what makes the warning actionable rather than annoying.
 *
 * Soft-deleted records are included: a patient deactivated in error is exactly
 * the kind of record that gets re-registered as a duplicate.
 */
export async function findPotentialDuplicates(candidate, { excludeId = null, limit = 10 } = {}) {
  const filter = buildCandidateFilter(candidate);
  if (!filter) return [];

  const query = excludeId ? { $and: [filter, { _id: { $ne: excludeId } }] } : filter;

  const candidates = await Patient.find(query)
    .select(
      'mrn firstName lastName dateOfBirth gender phone email nationalId status isActive createdAt',
    )
    // Bounded so a common surname cannot turn registration into a table scan.
    .limit(200)
    .lean();

  return candidates
    .map((existing) => {
      const { score, matchedOn } = scoreAgainst(candidate, existing);
      return {
        score,
        matchedOn,
        confidence: score >= MPI_THRESHOLDS.BLOCK ? 'high' : 'possible',
        patient: existing,
      };
    })
    .filter((match) => match.score >= MPI_THRESHOLDS.WARN)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** True when at least one match is confident enough to stop registration. */
export function hasBlockingDuplicate(matches = []) {
  return matches.some((match) => match.score >= MPI_THRESHOLDS.BLOCK);
}

export default { findPotentialDuplicates, hasBlockingDuplicate, MPI_THRESHOLDS };
