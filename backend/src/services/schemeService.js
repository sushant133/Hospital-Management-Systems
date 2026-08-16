import { Scheme, PatientEntitlement, SchemeClaim, Patient } from '../models/index.js';
import { COVERAGE_MODES } from '../models/Scheme.js';
import { fiscalYearOf, roundPaisa, ID_TYPES } from '../utils/nepal.js';
import ApiError from '../utils/ApiError.js';

/**
 * ============================================================================
 * THE SCHEME ENGINE
 * ============================================================================
 *
 * Decides which government schemes a patient may draw on, how much of a given
 * bill each one bears, and what is left for the patient to pay.
 *
 * ---------------------------------------------------------------------------
 * WHY ELIGIBILITY IS EVALUATED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 * Every decision this module makes is a decision about money the hospital will
 * later claim from government, and every one of them can be questioned in an
 * audit years afterwards. So each evaluation returns not just an answer but the
 * *reasons* — which rule matched, against which fact — and those reasons are
 * stored on the claim. "The system said so" is not a defence; "the patient's
 * senior citizen card number 123, verified by Sita on 12 Shrawan, and their
 * recorded age of 74" is.
 */

/* ==========================================================================
 * ELIGIBILITY
 * ======================================================================= */

/** Whole years old on a date, or null when the chart carries no age at all. */
function ageOn(patient, date) {
  if (!patient?.dateOfBirth) return null;
  const dob = new Date(patient.dateOfBirth);
  let years = date.getFullYear() - dob.getFullYear();
  const m = date.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && date.getDate() < dob.getDate())) years -= 1;
  return years;
}

/**
 * Evaluate one declarative eligibility rule.
 * Returns `{ passed, reason }` — the reason is kept either way, because a
 * *near miss* ("age 69, needs 70") is what a counter clerk needs to see.
 */
function evaluateRule(rule, context) {
  const { patient, diagnosisCodes = [], serviceCodes = [], asOf } = context;

  switch (rule.field) {
    case 'age-min': {
      const age = ageOn(patient, asOf);
      if (age === null) return { passed: false, reason: 'No age recorded on the chart.' };
      return {
        passed: age >= rule.value,
        reason: `Age ${age}, scheme requires ${rule.value} or over.`,
      };
    }
    case 'age-max': {
      const age = ageOn(patient, asOf);
      if (age === null) return { passed: false, reason: 'No age recorded on the chart.' };
      return {
        passed: age <= rule.value,
        reason: `Age ${age}, scheme requires ${rule.value} or under.`,
      };
    }
    case 'gender':
      return {
        passed: patient.gender === rule.value,
        reason: `Gender ${patient.gender}, scheme applies to ${rule.value}.`,
      };
    case 'has-identifier': {
      const held = (patient.identifiers || []).some((id) => id.type === rule.value);
      return {
        passed: held,
        reason: held
          ? `Holds a ${rule.value.replace(/_/g, ' ')}.`
          : `No ${rule.value.replace(/_/g, ' ')} recorded.`,
      };
    }
    case 'identifier-category': {
      const card = (patient.identifiers || []).find(
        (id) => id.type === ID_TYPES.DISABILITY_CARD,
      );
      const categories = Array.isArray(rule.value) ? rule.value : [rule.value];
      const passed = Boolean(card) && categories.includes(card.category);
      return {
        passed,
        reason: card
          ? `Disability card category "${card.category}", scheme covers ${categories.join('/')}.`
          : 'No disability card recorded.',
      };
    }
    case 'diagnosis-in': {
      const wanted = Array.isArray(rule.value) ? rule.value : [rule.value];
      const hit = diagnosisCodes.find((code) => wanted.includes(code));
      return {
        passed: Boolean(hit),
        reason: hit
          ? `Diagnosis ${hit} is on the scheme's list.`
          : 'No diagnosis on this encounter is covered by the scheme.',
      };
    }
    case 'service-in': {
      const wanted = Array.isArray(rule.value) ? rule.value : [rule.value];
      const hit = serviceCodes.find((code) => wanted.includes(code));
      return {
        passed: Boolean(hit),
        reason: hit ? `Service ${hit} is covered.` : 'No covered service on this bill.',
      };
    }
    case 'district-in': {
      const district = patient.address?.districtCode;
      const wanted = Array.isArray(rule.value) ? rule.value : [rule.value];
      return {
        passed: wanted.includes(district),
        reason: `Patient district ${district || 'not recorded'}; scheme covers ${wanted.join(', ')}.`,
      };
    }
    default:
      // An unknown rule must never silently pass — that would grant free care
      // on a condition nobody wrote.
      return { passed: false, reason: `Unrecognised eligibility rule "${rule.field}".` };
  }
}

/**
 * Which schemes this patient can currently draw on for this episode.
 *
 * Returns one entry per scheme the patient holds an entitlement for, each
 * marked eligible or not with its reasons. Ineligible ones are returned too:
 * the counter needs to see "senior citizen — patient is 69, needs 70" rather
 * than an empty list that looks like the system is broken.
 */
export async function evaluateEligibility({
  patientId,
  diagnosisCodes = [],
  serviceCodes = [],
  asOf = new Date(),
}) {
  const patient = await Patient.findById(patientId).lean();
  if (!patient) throw new ApiError(404, 'Patient not found.');

  const entitlements = await PatientEntitlement.find({
    patientId,
    status: 'active',
    isActive: true,
  })
    .populate('schemeId')
    .lean();

  const results = [];

  for (const entitlement of entitlements) {
    const scheme = entitlement.schemeId;
    if (!scheme) continue;

    const reasons = [];
    let eligible = true;

    // Gate 1 — is the scheme itself live?
    if (scheme.effectiveFrom && new Date(scheme.effectiveFrom) > asOf) {
      eligible = false;
      reasons.push('Scheme is not yet in effect.');
    }
    if (scheme.effectiveTo && new Date(scheme.effectiveTo) < asOf) {
      eligible = false;
      reasons.push('Scheme has been withdrawn.');
    }
    if (!scheme.isActive) {
      eligible = false;
      reasons.push('Scheme is not active in this hospital.');
    }

    // Gate 2 — is the patient's entitlement live and, where required, verified?
    if (entitlement.validTo && new Date(entitlement.validTo) < asOf) {
      eligible = false;
      reasons.push("The patient's card has expired.");
    }
    if (scheme.requiresDocument && !entitlement.verifiedAt) {
      eligible = false;
      reasons.push(
        `The ${scheme.documentLabel || 'card'} has not been sighted and verified — ` +
          'free care cannot be applied on an unverified entitlement.',
      );
    }

    // Gate 3 — the scheme's own rules.
    for (const rule of scheme.eligibility || []) {
      const { passed, reason } = evaluateRule(rule, {
        patient,
        diagnosisCodes,
        serviceCodes,
        asOf,
      });
      reasons.push(reason);
      if (!passed) eligible = false;
    }

    // Gate 4 — is there ceiling left?
    const remaining = remainingCeiling(scheme, entitlement, asOf);
    if (scheme.ceilingAmount > 0 && remaining <= 0) {
      eligible = false;
      reasons.push('The ceiling for this period is fully drawn down.');
    }

    results.push({
      schemeId: scheme._id,
      schemeCode: scheme.code,
      schemeName: scheme.name,
      schemeNameNe: scheme.nameNe,
      entitlementId: entitlement._id,
      eligible,
      reasons,
      ceilingAmount: scheme.ceilingAmount,
      utilisedAmount: entitlement.utilisedAmount || 0,
      remainingCeiling: remaining,
    });
  }

  return results;
}

/** How much of the ceiling is left in the current period. */
export function remainingCeiling(scheme, entitlement, asOf = new Date()) {
  if (!scheme.ceilingAmount || scheme.ceilingAmount <= 0) return Infinity;

  // A fiscal-year ceiling resets on Shrawan 1: utilisation recorded against a
  // previous year does not count against this one.
  const period = periodKey(scheme, asOf);
  const utilised =
    entitlement.utilisationPeriod === period ? entitlement.utilisedAmount || 0 : 0;

  return Math.max(0, roundPaisa(scheme.ceilingAmount - utilised));
}

/** The key a scheme's utilisation is bucketed under. */
export function periodKey(scheme, asOf = new Date()) {
  switch (scheme.ceilingPeriod) {
    case 'fiscal-year':
      return fiscalYearOf(asOf).code;
    case 'lifetime':
      return 'lifetime';
    case 'episode':
      return 'episode';
    default:
      return 'none';
  }
}

/* ==========================================================================
 * APPORTIONING A BILL
 * ======================================================================= */

/** Does this scheme cover this charge line? */
function coversLine(scheme, line) {
  if ((scheme.excludedServiceCodes || []).includes(line.serviceCode)) return false;

  const hasSourceFilter = (scheme.coveredSourceTypes || []).length > 0;
  const hasCodeFilter = (scheme.coveredServiceCodes || []).length > 0;

  // No filters at all means the scheme covers the whole bill.
  if (!hasSourceFilter && !hasCodeFilter) return true;

  if (hasSourceFilter && scheme.coveredSourceTypes.includes(line.sourceType)) return true;
  if (hasCodeFilter && scheme.coveredServiceCodes.includes(line.serviceCode)) return true;
  return false;
}

/**
 * Split a bill between the schemes that cover it and the patient.
 *
 * ---------------------------------------------------------------------------
 * ORDERING MATTERS AND IS NOT ARBITRARY
 * ---------------------------------------------------------------------------
 * Schemes are applied in a defined order — narrower, condition-specific
 * programmes first, broad entitlements last. Applying the broad senior-citizen
 * entitlement first would exhaust it on charges that a disease-specific fund
 * would have paid in full, leaving the patient exposed later in the year for
 * something the senior entitlement should have covered. The patient must never
 * be worse off because of the order we happened to iterate in.
 *
 * Returns the apportionment WITHOUT writing anything; the caller decides
 * whether to commit it. Keeping the calculation pure is what lets the counter
 * show a patient their liability before treatment starts.
 */
export async function apportion({ lines, eligibilities }) {
  const schemeIds = eligibilities.filter((e) => e.eligible).map((e) => e.schemeId);
  const schemes = await Scheme.find({ _id: { $in: schemeIds } }).lean();
  const schemeById = new Map(schemes.map((s) => [String(s._id), s]));

  // Narrower schemes first: a smaller ceiling means a more specific programme.
  // `Infinity` (no ceiling) therefore sorts last, which is what we want.
  const ordered = [...eligibilities]
    .filter((e) => e.eligible)
    .sort((a, b) => {
      const aCeil = a.ceilingAmount || Infinity;
      const bCeil = b.ceilingAmount || Infinity;
      return aCeil - bCeil;
    });

  /** Remaining uncovered value per line, keyed by line id. */
  const outstanding = new Map(
    lines.map((line) => [String(line._id), roundPaisa(line.amount)]),
  );

  const allocations = [];

  for (const eligibility of ordered) {
    const scheme = schemeById.get(String(eligibility.schemeId));
    if (!scheme) continue;

    let budget = eligibility.remainingCeiling;
    const covered = [];

    for (const line of lines) {
      const key = String(line._id);
      const left = outstanding.get(key);
      if (left <= 0) continue;
      if (!coversLine(scheme, line)) continue;

      let share;
      switch (scheme.coverageMode) {
        case COVERAGE_MODES.FULL:
          share = left;
          break;
        case COVERAGE_MODES.PERCENTAGE:
          share = roundPaisa((left * scheme.coveragePercent) / 100);
          break;
        case COVERAGE_MODES.PACKAGE_RATE:
          // The published package rate caps what the scheme pays; anything the
          // hospital charges above it stays with the patient.
          share = Math.min(left, roundPaisa(line.packageRate ?? left));
          break;
        case COVERAGE_MODES.FLAT_PER_EPISODE:
          // Handled once per episode below, not per line.
          share = 0;
          break;
        default:
          share = 0;
      }

      share = Math.min(share, budget);
      if (share <= 0) continue;

      outstanding.set(key, roundPaisa(left - share));
      budget = roundPaisa(budget - share);
      covered.push({
        lineItemId: line._id,
        description: line.description,
        serviceCode: line.serviceCode || '',
        amount: share,
      });
    }

    // Flat incentives (Aama Surakshya transport, ANC visit) pay a fixed sum per
    // episode rather than a share of the bill.
    if (scheme.coverageMode === COVERAGE_MODES.FLAT_PER_EPISODE && scheme.flatAmount > 0) {
      const flat = Math.min(scheme.flatAmount, eligibility.remainingCeiling);
      if (flat > 0) {
        covered.push({
          lineItemId: null,
          description: `${scheme.name} — fixed entitlement`,
          serviceCode: scheme.code,
          amount: roundPaisa(flat),
        });
      }
    }

    const total = roundPaisa(covered.reduce((sum, c) => sum + c.amount, 0));
    if (total > 0) {
      allocations.push({
        schemeId: scheme._id,
        schemeCode: scheme.code,
        schemeName: scheme.name,
        entitlementId: eligibility.entitlementId,
        amount: total,
        lines: covered,
      });
    }
  }

  const grossTotal = roundPaisa(lines.reduce((sum, l) => sum + l.amount, 0));
  const schemeTotal = roundPaisa(allocations.reduce((sum, a) => sum + a.amount, 0));

  return {
    grossTotal,
    schemeCoveredAmount: schemeTotal,
    patientResponsibleAmount: roundPaisa(Math.max(0, grossTotal - schemeTotal)),
    allocations,
  };
}

/* ==========================================================================
 * COMMITTING THE DECISION
 * ======================================================================= */

/**
 * Turn an apportionment into claims, and draw down the ceilings.
 *
 * NOTE ON ATOMICITY: this writes several documents (claims, entitlement
 * counters, the invoice). Until the backend runs against a replica set and
 * these are wrapped in a transaction (Tier D, D1), a mid-flight failure can
 * leave a ceiling drawn down without the matching claim. The reconciliation
 * report in `schemeReport` exists to surface that, and the fix belongs with
 * the wider transaction work rather than a private half-measure here.
 */
export async function commitApportionment({
  apportionment,
  patientId,
  encounterId,
  invoiceId,
  user,
  asOf = new Date(),
}) {
  const fiscalYear = fiscalYearOf(asOf).code;
  const created = [];

  for (const allocation of apportionment.allocations) {
    const scheme = await Scheme.findById(allocation.schemeId).lean();
    if (!scheme) continue;

    const fileBy = new Date(asOf);
    fileBy.setDate(fileBy.getDate() + (scheme.claimWindowDays || 90));

    const claim = await SchemeClaim.create({
      schemeId: allocation.schemeId,
      schemeCode: allocation.schemeCode,
      entitlementId: allocation.entitlementId,
      patientId,
      encounterId,
      invoiceId,
      fiscalYear,
      claimedAmount: allocation.amount,
      lines: allocation.lines.filter((l) => l.lineItemId),
      fileBy,
      status: 'draft',
      createdBy: user?._id ?? null,
    });

    // Draw down the ceiling. `utilisationPeriod` is reset alongside the amount
    // so a new fiscal year starts from zero rather than inheriting last year's.
    const period = periodKey(scheme, asOf);
    const entitlement = await PatientEntitlement.findById(allocation.entitlementId);
    if (entitlement) {
      if (entitlement.utilisationPeriod !== period) {
        entitlement.utilisationPeriod = period;
        entitlement.utilisedAmount = 0;
      }
      entitlement.utilisedAmount = roundPaisa(entitlement.utilisedAmount + allocation.amount);
      await entitlement.save();
    }

    created.push(claim);
  }

  return created;
}

export default {
  evaluateEligibility,
  apportion,
  commitApportionment,
  remainingCeiling,
  periodKey,
};
