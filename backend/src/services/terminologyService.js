import { CodeSystem } from '../models/index.js';
import { CODE_SYSTEMS, CODE_SYSTEM_LABELS } from '../models/CodeSystem.js';
import ApiError from '../utils/ApiError.js';

/**
 * ============================================================================
 * TERMINOLOGY LOOKUP AND VALIDATION
 * ============================================================================
 *
 * The gate between free text and coded data.
 *
 * ---------------------------------------------------------------------------
 * WHAT "NOT LOADED" MEANS, AND WHY IT MATTERS
 * ---------------------------------------------------------------------------
 * A hospital commissioning this system may not have loaded ICD yet. Two wrong
 * answers are available and both are worse than the truth:
 *
 *   - accept anything, and the morbidity return becomes fiction;
 *   - reject everything, and nobody can record a diagnosis at all.
 *
 * So `validate()` distinguishes "this code is wrong" from "this terminology is
 * not installed", and the caller decides. Coding is *enforced at discharge*
 * (see `assertEncounterCoded`) rather than at every keystroke, which is where
 * the MRD coder actually works.
 */

/** Which system a given kind of record codes against. */
export const CODING_TARGETS = Object.freeze({
  diagnosis: [CODE_SYSTEMS.ICD11, CODE_SYSTEMS.ICD10],
  problem: [CODE_SYSTEMS.SNOMED, CODE_SYSTEMS.ICD11, CODE_SYSTEMS.ICD10],
  allergy: [CODE_SYSTEMS.SNOMED],
  observation: [CODE_SYSTEMS.LOINC],
  procedure: [CODE_SYSTEMS.ICHI, CODE_SYSTEMS.ICD9_PROCEDURE],
});

/** Is a terminology installed at all? Cached — this is asked on every search. */
const installedCache = new Map();

export async function isInstalled(system) {
  if (installedCache.has(system)) return installedCache.get(system);
  const count = await CodeSystem.countDocuments({ system });
  const installed = count > 0;
  // Only cache a positive: a system that is missing today may be imported
  // in ten minutes, and a cached `false` would outlive the import.
  if (installed) installedCache.set(system, true);
  return installed;
}

/** Called by the importer so a fresh load is visible immediately. */
export function clearInstalledCache() {
  installedCache.clear();
}

/**
 * Typeahead search.
 *
 * Prefix-matches the denormalised `searchText` first (fast, indexed, and what a
 * clinician typing "pneum" expects), then falls back to full-text for
 * multi-word queries. Only selectable leaves are returned: ICD forbids coding
 * to a chapter heading, and offering one guarantees somebody picks it.
 */
export async function search({ system, query, limit = 20, includeNonLeaf = false }) {
  if (!query || query.trim().length < 2) return [];

  const installed = await isInstalled(system);
  if (!installed) {
    throw new ApiError(
      503,
      `${CODE_SYSTEM_LABELS[system]?.en || system} has not been imported into this system yet. ` +
        'Run scripts/importTerminology.js before coding against it.',
      'TERMINOLOGY_NOT_INSTALLED',
    );
  }

  const base = {
    system,
    isSelectable: true,
    ...(includeNonLeaf ? {} : { isLeaf: true }),
  };

  const term = query.trim().toLowerCase();

  // An exact code match always wins — a coder who knows "J18.9" should not have
  // to scroll past twelve pneumonias to reach it.
  const exact = await CodeSystem.find({ ...base, code: term.toUpperCase() })
    .limit(3)
    .lean();

  const prefix = await CodeSystem.find({
    ...base,
    searchText: { $regex: `\\b${escapeRegex(term)}`, $options: 'i' },
  })
    .limit(limit)
    .lean();

  const results = dedupe([...exact, ...prefix]);
  if (results.length >= limit) return results.slice(0, limit);

  // Multi-word queries ("acute kidney injury") rarely prefix-match cleanly.
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const textHits = await CodeSystem.find(
      { ...base, $text: { $search: term } },
      { score: { $meta: 'textScore' } },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit - results.length)
      .lean();
    return dedupe([...results, ...textHits]).slice(0, limit);
  }

  return results.slice(0, limit);
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.system}:${row.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Validate a coded concept.
 *
 * Returns `{ valid, reason, concept }` and never throws, because this runs
 * inside form validation where a rejection needs a message, not a stack trace.
 */
export async function validate({ system, code }) {
  if (!system || !code) {
    return { valid: false, reason: 'MISSING', message: 'A code and its system are required.' };
  }

  if (!(await isInstalled(system))) {
    return {
      valid: false,
      reason: 'NOT_INSTALLED',
      message: `${CODE_SYSTEM_LABELS[system]?.en || system} is not installed on this server.`,
    };
  }

  const concept = await CodeSystem.findOne({ system, code: code.toUpperCase() }).lean();
  if (!concept) {
    return { valid: false, reason: 'UNKNOWN_CODE', message: `"${code}" is not a ${system} code.` };
  }
  if (!concept.isSelectable) {
    return {
      valid: false,
      reason: 'RETIRED',
      message: `${code} has been retired and cannot be newly assigned.`,
      concept,
    };
  }
  if (!concept.isLeaf) {
    return {
      valid: false,
      reason: 'NOT_LEAF',
      message: `${code} is a category heading, not a codable concept. Choose a specific code beneath it.`,
      concept,
    };
  }

  return { valid: true, concept };
}

/** Resolve a code to the embeddable concept, or throw with a usable message. */
export async function resolve({ system, code, text = '' }) {
  const result = await validate({ system, code });
  if (!result.valid) {
    throw new ApiError(400, result.message, result.reason);
  }
  return {
    system,
    code: result.concept.code,
    display: result.concept.display,
    version: result.concept.version,
    text,
  };
}

/** Translate a code into another system, using the stored crosswalk. */
export async function translate({ system, code, target }) {
  const concept = await CodeSystem.findOne({ system, code: code.toUpperCase() }).lean();
  if (!concept) return null;

  const mapping = (concept.mappings || []).find((m) => m.system === target);
  if (!mapping) return null;

  const mapped = await CodeSystem.findOne({ system: target, code: mapping.code }).lean();
  return mapped
    ? {
        system: target,
        code: mapped.code,
        display: mapped.display,
        version: mapped.version,
        equivalence: mapping.equivalence,
      }
    : null;
}

/**
 * Is this diagnosis notifiable?
 *
 * Answered from the concept itself so the alert fires when the clinician
 * records it, not when someone compiles the weekly EWARS report and discovers
 * a cholera case from five days ago.
 */
export async function notifiableCheck(concepts = []) {
  const codes = concepts.filter((c) => c?.code).map((c) => c.code.toUpperCase());
  if (codes.length === 0) return [];

  return CodeSystem.find({ code: { $in: codes }, isNotifiable: true })
    .select('system code display displayNe notifiableWithinHours')
    .lean();
}

/**
 * Expand a code to itself plus every descendant.
 *
 * "How many respiratory admissions" means J00–J99, not the handful of codes
 * anyone happened to type. Uses the denormalised `ancestors` array so this is
 * one indexed query rather than a recursive walk.
 */
export async function expand({ system, code }) {
  const rows = await CodeSystem.find({
    system,
    $or: [{ code: code.toUpperCase() }, { ancestors: code.toUpperCase() }],
  })
    .select('code display chapter')
    .lean();
  return rows;
}

/** What is installed, for the admin health screen and the coding UI. */
export async function installedSystems() {
  const rows = await CodeSystem.aggregate([
    { $group: { _id: { system: '$system', version: '$version' }, concepts: { $sum: 1 } } },
    { $sort: { concepts: -1 } },
  ]);

  const byInstalled = rows.map((row) => ({
    system: row._id.system,
    version: row._id.version,
    concepts: row.concepts,
    label: CODE_SYSTEM_LABELS[row._id.system]?.en || row._id.system,
    use: CODE_SYSTEM_LABELS[row._id.system]?.use || '',
  }));

  const present = new Set(byInstalled.map((r) => r.system));
  const missing = Object.values(CODE_SYSTEMS)
    .filter((s) => !present.has(s))
    .map((s) => ({
      system: s,
      label: CODE_SYSTEM_LABELS[s]?.en || s,
      use: CODE_SYSTEM_LABELS[s]?.use || '',
    }));

  return { installed: byInstalled, missing };
}

export default {
  search,
  validate,
  resolve,
  translate,
  expand,
  notifiableCheck,
  isInstalled,
  installedSystems,
  clearInstalledCache,
  CODING_TARGETS,
};
