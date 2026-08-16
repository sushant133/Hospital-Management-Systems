import { Drug, DrugInteraction, Patient, VitalSigns, LabResult, Prescription } from '../models/index.js';

/**
 * ============================================================================
 * MEDICATION SAFETY
 * ============================================================================
 *
 * Everything checked at the moment of prescribing.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT MATTERED
 * ---------------------------------------------------------------------------
 * The previous version checked two things: pairwise interactions against a
 * self-maintained table, and a flat daily-dose range. It did NOT check the
 * patient's recorded allergies against what was being prescribed — the single
 * most common preventable medication harm in any hospital, and the one a
 * clinician is least able to catch unaided because the allergy was recorded by
 * someone else, months ago, on a different screen.
 *
 * Now checked, in descending order of how often it kills someone:
 *
 *   1. ALLERGY — by generic AND by cross-reactive class. A patient allergic to
 *      penicillin must be stopped on amoxicillin, which shares no generic name
 *      with it. Class matching is what makes that work.
 *   2. RENAL DOSING — from the most recent creatinine the lab module already
 *      holds. Renally-cleared drugs at full dose in renal failure is a slow,
 *      quiet, entirely preventable injury.
 *   3. PAEDIATRIC WEIGHT DOSING — from the latest recorded weight, not retyped.
 *      Paediatric overdose is almost always an arithmetic error.
 *   4. DUPLICATE THERAPY — the same drug or class prescribed twice, usually
 *      because two teams prescribed independently.
 *   5. MAXIMUM DAILY DOSE.
 *   6. INTERACTIONS — kept, but see the honest note below.
 *   7. PREGNANCY / LACTATION category.
 *
 * ---------------------------------------------------------------------------
 * AN HONEST LIMITATION
 * ---------------------------------------------------------------------------
 * The interaction table is maintained by hand in this hospital's own database.
 * It will be sparse, and a sparse interaction table produces false reassurance:
 * a clinician who sees "no interactions found" reasonably infers there are
 * none. `interactionCoverage` in the result reports how many pairs were
 * actually checkable, so the UI can say "3 of 6 pairs have data" rather than a
 * bare green tick. A licensed drug knowledge base is the production answer.
 */

/** Severity ordering — drives whether a warning blocks or merely warns. */
export const SEVERITY = Object.freeze({
  CONTRAINDICATED: 'contraindicated',
  SEVERE: 'severe',
  MODERATE: 'moderate',
  MILD: 'mild',
  INFO: 'info',
});

const SEVERITY_RANK = { contraindicated: 4, severe: 3, moderate: 2, mild: 1, info: 0 };

/**
 * Severities that must not be overridden by a click alone.
 *
 * A warning that everyone dismisses reflexively is worse than no warning — it
 * trains the dismissal. So the trivial ones inform, and only these two demand a
 * typed reason, which is also what makes the override auditable.
 */
export const REQUIRES_OVERRIDE_REASON = [SEVERITY.CONTRAINDICATED, SEVERITY.SEVERE];

const normalise = (value) => String(value ?? '').trim().toLowerCase();
const pairKey = (a, b) => [normalise(a), normalise(b)].sort().join('|');

/** Pull the first number out of a dosage string like "500 mg TDS". */
export function parseDoseAmount(raw) {
  const match = String(raw ?? '').replace(/,/g, '').match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

/**
 * Doses per day from a frequency string.
 * Recognises both the Latin abbreviations still used on Nepali charts and plain
 * forms. Returns null when it cannot tell — the caller then skips the daily
 * total rather than guessing, because a wrong multiplier is worse than none.
 */
export function parseFrequencyPerDay(raw) {
  const text = normalise(raw);
  if (!text) return null;

  const table = [
    [/\b(od|once daily|daily|qd|hs|nocte)\b/, 1],
    [/\b(bd|bid|twice)\b/, 2],
    [/\b(tds|tid|thrice|three times)\b/, 3],
    [/\b(qds|qid|four times)\b/, 4],
    [/\b(5 times|five times)\b/, 5],
    [/\b(sos|prn|as needed|stat)\b/, 1],
  ];
  for (const [pattern, perDay] of table) if (pattern.test(text)) return perDay;

  // "q8h" / "every 8 hours"
  const hourly = text.match(/(?:q|every\s*)(\d+)\s*h/);
  if (hourly) {
    const hours = Number(hourly[1]);
    if (hours > 0) return Math.round((24 / hours) * 100) / 100;
  }
  return null;
}

/* ==========================================================================
 * 1. ALLERGY
 * ======================================================================= */

/**
 * Check what is being prescribed against what the patient reacts to.
 *
 * Matches on three levels, because a recorded allergy is rarely written in the
 * same words as the formulary entry:
 *   - generic name ("amoxicillin" vs "amoxicillin")
 *   - allergen class ("penicillin" recorded, amoxicillin prescribed)
 *   - substring, as a last resort for free-text allergies ("penicillin V")
 *
 * The substring pass is deliberately loose. A false positive costs a clinician
 * one dismissal; a false negative can cost a life, and the asymmetry is not
 * close.
 */
export function checkAllergies({ drugs = [], allergies = [] }) {
  const warnings = [];
  if (allergies.length === 0 || drugs.length === 0) return warnings;

  const recorded = allergies
    .filter((a) => a?.substance)
    .map((a) => ({
      raw: a.substance,
      key: normalise(a.substance),
      severity: a.severity || 'moderate',
      reaction: a.reaction || '',
    }));

  for (const drug of drugs) {
    const generic = normalise(drug.genericName);
    const brand = normalise(drug.name);
    const classes = (drug.allergenClasses || []).map(normalise);

    for (const allergy of recorded) {
      let matchedOn = null;

      if (allergy.key === generic || allergy.key === brand) matchedOn = 'generic name';
      else if (classes.includes(allergy.key)) matchedOn = 'drug class';
      else if (
        allergy.key.length >= 4 &&
        (generic.includes(allergy.key) ||
          allergy.key.includes(generic) ||
          classes.some((c) => c.length >= 4 && (c.includes(allergy.key) || allergy.key.includes(c))))
      ) {
        matchedOn = 'possible cross-reactivity';
      }

      if (!matchedOn) continue;

      // A recorded severe allergy is a contraindication, not a warning.
      const severity =
        allergy.severity === 'severe' ? SEVERITY.CONTRAINDICATED : SEVERITY.SEVERE;

      warnings.push({
        kind: 'allergy',
        severity,
        drugId: drug._id,
        drugName: drug.name,
        allergen: allergy.raw,
        matchedOn,
        reaction: allergy.reaction,
        message:
          `${drug.name} — the patient has a recorded ${allergy.severity} allergy to ` +
          `"${allergy.raw}"${allergy.reaction ? ` (${allergy.reaction})` : ''}, matched on ${matchedOn}.`,
      });
    }
  }

  return warnings;
}

/* ==========================================================================
 * 2. RENAL DOSING
 * ======================================================================= */

/**
 * Cockcroft–Gault creatinine clearance, in mL/min.
 *
 * Chosen over eGFR/MDRD deliberately: renal drug dosing references are written
 * against Cockcroft–Gault, and mixing the two gives a number that looks right
 * and adjusts the dose wrongly.
 */
export function creatinineClearance({ ageYears, weightKg, serumCreatinineMgDl, sex }) {
  if (!ageYears || !weightKg || !serumCreatinineMgDl) return null;
  if (serumCreatinineMgDl <= 0) return null;

  const base = ((140 - ageYears) * weightKg) / (72 * serumCreatinineMgDl);
  const adjusted = sex === 'female' ? base * 0.85 : base;
  return Math.round(adjusted * 10) / 10;
}

export function checkRenalDosing({ drugs = [], creatinineClearanceMlMin, hasCreatinine }) {
  const warnings = [];
  const renallyCleared = drugs.filter((d) => d.renallyCleared || d.renalAdjustment?.length);

  if (renallyCleared.length === 0) return warnings;

  // No recent creatinine at all is itself worth saying: prescribing a renally
  // cleared drug blind is a decision, and it should be a conscious one.
  if (!hasCreatinine) {
    for (const drug of renallyCleared) {
      warnings.push({
        kind: 'renal-unknown',
        severity: SEVERITY.MODERATE,
        drugId: drug._id,
        drugName: drug.name,
        message:
          `${drug.name} is renally cleared and there is no recent creatinine on file. ` +
          'Consider checking renal function before prescribing.',
      });
    }
    return warnings;
  }

  if (creatinineClearanceMlMin === null || creatinineClearanceMlMin === undefined) return warnings;

  for (const drug of renallyCleared) {
    const bands = drug.renalAdjustment || [];
    const band = bands.find(
      (b) =>
        creatinineClearanceMlMin >= (b.minClearance ?? -Infinity) &&
        creatinineClearanceMlMin < (b.maxClearance ?? Infinity),
    );

    if (band) {
      warnings.push({
        kind: 'renal-adjustment',
        severity: band.contraindicated ? SEVERITY.CONTRAINDICATED : SEVERITY.SEVERE,
        drugId: drug._id,
        drugName: drug.name,
        creatinineClearance: creatinineClearanceMlMin,
        recommendation: band.recommendation,
        message:
          `${drug.name} — creatinine clearance is ${creatinineClearanceMlMin} mL/min. ` +
          (band.contraindicated
            ? 'This drug is contraindicated at this level of renal function.'
            : `Dose adjustment required: ${band.recommendation}`),
      });
    } else if (creatinineClearanceMlMin < 60) {
      // The formulary carries no band for this drug, but renal function is
      // impaired — say so rather than staying silent.
      warnings.push({
        kind: 'renal-caution',
        severity: SEVERITY.MODERATE,
        drugId: drug._id,
        drugName: drug.name,
        creatinineClearance: creatinineClearanceMlMin,
        message:
          `${drug.name} is renally cleared and creatinine clearance is ` +
          `${creatinineClearanceMlMin} mL/min. Check whether a dose reduction applies.`,
      });
    }
  }

  return warnings;
}

/* ==========================================================================
 * 3. PAEDIATRIC WEIGHT-BASED DOSING
 * ======================================================================= */

/**
 * Compare the prescribed dose against mg/kg bounds.
 *
 * Weight comes from the latest recorded vitals rather than being retyped: the
 * commonest paediatric overdose is an arithmetic slip on a weight somebody
 * remembered rather than read.
 */
export function checkWeightBasedDosing({ drugs = [], items = [], weightKg, ageYears }) {
  const warnings = [];
  if (!weightKg) {
    // Only worth flagging for children, where weight dosing is the norm.
    if (ageYears !== null && ageYears !== undefined && ageYears < 12 && drugs.length > 0) {
      warnings.push({
        kind: 'weight-missing',
        severity: SEVERITY.MODERATE,
        message:
          'No recent weight is recorded for this child. Paediatric doses are weight-based; ' +
          'record a weight before prescribing.',
      });
    }
    return warnings;
  }

  const byId = new Map(drugs.map((d) => [String(d._id), d]));

  for (const item of items) {
    const drug = byId.get(String(item.drugId));
    if (!drug) continue;
    if (drug.minDosePerKg == null && drug.maxDosePerKg == null) continue;

    const singleDose = parseDoseAmount(item.dosage);
    if (singleDose === null) continue;

    const perDay = parseFrequencyPerDay(item.frequency) ?? 1;
    const dailyTotal = singleDose * perDay;
    const perKgPerDay = Math.round((dailyTotal / weightKg) * 100) / 100;

    if (drug.maxDosePerKg != null && perKgPerDay > drug.maxDosePerKg) {
      warnings.push({
        kind: 'dose-per-kg-high',
        severity: perKgPerDay > drug.maxDosePerKg * 1.5 ? SEVERITY.CONTRAINDICATED : SEVERITY.SEVERE,
        drugId: drug._id,
        drugName: drug.name,
        weightKg,
        perKgPerDay,
        maxDosePerKg: drug.maxDosePerKg,
        message:
          `${drug.name} — ${perKgPerDay} ${drug.doseUnit || 'mg'}/kg/day at ${weightKg} kg ` +
          `exceeds the maximum of ${drug.maxDosePerKg}.`,
      });
    }

    if (drug.minDosePerKg != null && perKgPerDay < drug.minDosePerKg) {
      warnings.push({
        kind: 'dose-per-kg-low',
        severity: SEVERITY.MODERATE,
        drugId: drug._id,
        drugName: drug.name,
        weightKg,
        perKgPerDay,
        minDosePerKg: drug.minDosePerKg,
        message:
          `${drug.name} — ${perKgPerDay} ${drug.doseUnit || 'mg'}/kg/day is below the ` +
          `usual minimum of ${drug.minDosePerKg}; the dose may be subtherapeutic.`,
      });
    }
  }

  return warnings;
}

/* ==========================================================================
 * 4. DUPLICATE THERAPY
 * ======================================================================= */

/**
 * The same drug, or two drugs of the same class, on one patient at once.
 *
 * Usually happens because two teams prescribed independently — the ward and the
 * consultant, or admission and a later review. Nobody sees the whole list, which
 * is exactly what this check is for.
 */
export function checkDuplicateTherapy({ drugs = [], activeDrugs = [] }) {
  const warnings = [];
  const all = [...drugs, ...activeDrugs];

  const byGeneric = new Map();
  for (const drug of all) {
    const key = normalise(drug.genericName);
    if (!key) continue;
    if (!byGeneric.has(key)) byGeneric.set(key, []);
    byGeneric.get(key).push(drug);
  }

  for (const [generic, group] of byGeneric) {
    if (group.length < 2) continue;
    warnings.push({
      kind: 'duplicate-generic',
      severity: SEVERITY.SEVERE,
      generic,
      drugNames: group.map((d) => d.name),
      message:
        `${generic} appears ${group.length} times (${group.map((d) => d.name).join(', ')}). ` +
        'Check this is not an unintended double dose.',
    });
  }

  // Therapeutic class duplication — two NSAIDs, two ACE inhibitors.
  const byClass = new Map();
  for (const drug of all) {
    for (const cls of drug.therapeuticClasses || []) {
      const key = normalise(cls);
      if (!key) continue;
      if (!byClass.has(key)) byClass.set(key, new Set());
      byClass.get(key).add(drug.name);
    }
  }

  for (const [cls, names] of byClass) {
    if (names.size < 2) continue;
    warnings.push({
      kind: 'duplicate-class',
      severity: SEVERITY.MODERATE,
      therapeuticClass: cls,
      drugNames: [...names],
      message: `${[...names].join(' and ')} are both ${cls}. Confirm both are intended.`,
    });
  }

  return warnings;
}

/* ==========================================================================
 * 5. MAXIMUM DAILY DOSE
 * ======================================================================= */

export function checkDoseRanges({ drugs = [], items = [] }) {
  const byId = new Map(drugs.map((d) => [String(d._id), d]));
  const warnings = [];

  for (const item of items) {
    const drug = byId.get(String(item.drugId));
    if (!drug) continue;

    const singleDose = parseDoseAmount(item.dosage);
    if (singleDose === null) continue;

    // Compare DAILY totals against daily limits. The previous version compared
    // a single dose against the daily maximum, which missed the whole class of
    // error where each dose is fine and the frequency is not.
    const perDay = parseFrequencyPerDay(item.frequency);
    const dailyTotal = perDay === null ? singleDose : singleDose * perDay;

    if (drug.maxDailyDose != null && dailyTotal > drug.maxDailyDose) {
      warnings.push({
        kind: 'above-maximum',
        severity: dailyTotal > drug.maxDailyDose * 1.5 ? SEVERITY.CONTRAINDICATED : SEVERITY.SEVERE,
        drugId: drug._id,
        drugName: drug.name,
        dailyTotal,
        perDay,
        maxDailyDose: drug.maxDailyDose,
        unit: drug.doseUnit,
        message:
          `${drug.name} — ${dailyTotal}${drug.doseUnit || ''}/day` +
          `${perDay ? ` (${singleDose} × ${perDay})` : ''} exceeds the maximum of ` +
          `${drug.maxDailyDose}${drug.doseUnit || ''}.`,
      });
    }

    if (drug.minDailyDose != null && dailyTotal < drug.minDailyDose) {
      warnings.push({
        kind: 'below-minimum',
        severity: SEVERITY.MILD,
        drugId: drug._id,
        drugName: drug.name,
        dailyTotal,
        minDailyDose: drug.minDailyDose,
        unit: drug.doseUnit,
        message: `${drug.name} — ${dailyTotal}${drug.doseUnit || ''}/day is below the usual minimum.`,
      });
    }
  }

  return warnings;
}

/* ==========================================================================
 * 6. INTERACTIONS
 * ======================================================================= */

export async function checkInteractions({ drugs = [], extraGenerics = [] }) {
  const generics = [
    ...drugs.map((d) => normalise(d.genericName)),
    ...extraGenerics.map(normalise),
  ].filter(Boolean);
  const unique = [...new Set(generics)];
  if (unique.length < 2) return { interactions: [], coverage: { pairs: 0, checked: 0 } };

  const rows = await DrugInteraction.find({
    isActive: true,
    $or: unique.flatMap((g) => [{ genericA: g }, { genericB: g }]),
  }).lean();

  const wanted = new Set();
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) wanted.add(pairKey(unique[i], unique[j]));
  }

  const known = new Set(rows.map((r) => pairKey(r.genericA, r.genericB)));

  const interactions = rows
    .filter((row) => wanted.has(pairKey(row.genericA, row.genericB)))
    .map((row) => ({
      kind: 'interaction',
      severity: row.severity === 'severe' ? SEVERITY.SEVERE : row.severity,
      genericA: row.genericA,
      genericB: row.genericB,
      description: row.description,
      message: `${row.genericA} + ${row.genericB}: ${row.description}`,
    }));

  return {
    interactions,
    /**
     * How many of the possible pairs the local table actually knows about.
     *
     * Reported so the UI can say "3 of 6 pairs checked" rather than showing a
     * bare green tick. A sparse table producing silent reassurance is the real
     * hazard here — a clinician reasonably reads "no interactions" as "none
     * exist".
     */
    coverage: {
      pairs: wanted.size,
      checked: [...wanted].filter((p) => known.has(p)).length,
    },
  };
}

/* ==========================================================================
 * 7. PREGNANCY AND LACTATION
 * ======================================================================= */

export function checkPregnancy({ drugs = [], isPregnant, isBreastfeeding }) {
  const warnings = [];
  if (!isPregnant && !isBreastfeeding) return warnings;

  for (const drug of drugs) {
    if (isPregnant && drug.pregnancyCategory) {
      const category = String(drug.pregnancyCategory).toUpperCase();
      if (['D', 'X'].includes(category)) {
        warnings.push({
          kind: 'pregnancy',
          severity: category === 'X' ? SEVERITY.CONTRAINDICATED : SEVERITY.SEVERE,
          drugId: drug._id,
          drugName: drug.name,
          category,
          message:
            `${drug.name} is pregnancy category ${category}` +
            `${category === 'X' ? ' — contraindicated in pregnancy.' : ' — evidence of fetal risk.'}`,
        });
      }
    }
    if (isBreastfeeding && drug.lactationRisk === 'avoid') {
      warnings.push({
        kind: 'lactation',
        severity: SEVERITY.SEVERE,
        drugId: drug._id,
        drugName: drug.name,
        message: `${drug.name} should be avoided while breastfeeding.`,
      });
    }
  }

  return warnings;
}

/* ==========================================================================
 * THE COMBINED CHECK
 * ======================================================================= */

/** Most recent numeric result for an analyte, within `withinDays`. */
async function latestResultValue({ patientId, analyteCodes, withinDays = 90 }) {
  const since = new Date(Date.now() - withinDays * 86400000);
  const row = await LabResult.findOne({
    patientId,
    isActive: true,
    resultedAt: { $gte: since },
    $or: [{ analyteCode: { $in: analyteCodes } }, { 'concept.code': { $in: analyteCodes } }],
  })
    .sort({ resultedAt: -1 })
    .lean();

  const value = Number(row?.numericValue ?? row?.value);
  return Number.isFinite(value) ? { value, resultedAt: row.resultedAt } : null;
}

/**
 * Run every check for one prescribing decision.
 *
 * Gathers the patient's context itself — allergies, weight, renal function,
 * what they are already on — rather than trusting the caller to pass it. A
 * check that silently does nothing because a field was omitted is worse than
 * no check, and the prescribing screen has no reason to know which lab test
 * feeds renal dosing.
 */
export async function evaluateMedicationSafety({
  patientId,
  drugIds = [],
  items = [],
  extraGenerics = [],
  encounterId = null,
}) {
  const drugs = await Drug.find({ _id: { $in: drugIds }, isActive: true }).lean();

  const patient = patientId
    ? await Patient.findById(patientId).select('medicalHistory dateOfBirth gender flags').lean()
    : null;

  const allergies = patient?.medicalHistory?.allergies ?? [];

  // Age, for paediatric and renal calculations.
  let ageYears = null;
  if (patient?.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth);
    ageYears = Math.floor((Date.now() - dob.getTime()) / (365.25 * 86400000));
  }

  // Latest weight, from vitals rather than retyped.
  let weightKg = null;
  if (patientId) {
    const vitals = await VitalSigns.findOne({ patientId, weight: { $ne: null }, isActive: true })
      .sort({ recordedAt: -1 })
      .select('weight recordedAt')
      .lean();
    weightKg = vitals?.weight ?? null;
  }

  // Renal function, from the lab module.
  let creatinine = null;
  if (patientId) {
    creatinine = await latestResultValue({
      patientId,
      analyteCodes: ['CREAT', 'CREATININE', '2160-0'], // local codes + LOINC
    });
  }
  const clearance = creatinine
    ? creatinineClearance({
        ageYears,
        weightKg,
        serumCreatinineMgDl: creatinine.value,
        sex: patient?.gender,
      })
    : null;

  // What the patient is already taking, so duplicates and interactions see the
  // whole picture rather than only this prescription.
  let activeDrugs = [];
  if (patientId) {
    const active = await Prescription.find({
      patientId,
      status: { $in: ['active', 'dispensed'] },
      isActive: true,
      ...(encounterId ? {} : {}),
    })
      .select('items.drugId')
      .lean();
    const activeIds = active.flatMap((p) => (p.items || []).map((i) => i.drugId)).filter(Boolean);
    if (activeIds.length > 0) {
      activeDrugs = await Drug.find({ _id: { $in: activeIds }, isActive: true }).lean();
    }
  }

  const { interactions, coverage } = await checkInteractions({
    drugs: [...drugs, ...activeDrugs],
    extraGenerics,
  });

  const warnings = [
    ...checkAllergies({ drugs, allergies }),
    ...checkRenalDosing({
      drugs,
      creatinineClearanceMlMin: clearance,
      hasCreatinine: Boolean(creatinine),
    }),
    ...checkWeightBasedDosing({ drugs, items, weightKg, ageYears }),
    ...checkDuplicateTherapy({ drugs, activeDrugs }),
    ...checkDoseRanges({ drugs, items }),
    ...checkPregnancy({
      drugs,
      isPregnant: Boolean(patient?.flags?.isPregnant),
      isBreastfeeding: Boolean(patient?.flags?.isBreastfeeding),
    }),
    ...interactions,
  ];

  // Most dangerous first — a clinician reads the top of the list.
  warnings.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  const blocking = warnings.filter((w) => REQUIRES_OVERRIDE_REASON.includes(w.severity));

  return {
    drugs,
    warnings,
    /** Warnings that need a typed reason before the prescription can be signed. */
    blocking,
    requiresOverride: blocking.length > 0,
    highestSeverity: warnings[0]?.severity ?? null,
    context: {
      ageYears,
      weightKg,
      creatinine: creatinine?.value ?? null,
      creatinineAt: creatinine?.resultedAt ?? null,
      creatinineClearance: clearance,
      allergiesOnFile: allergies.length,
      activeMedications: activeDrugs.length,
    },
    interactionCoverage: coverage,
  };
}

export default {
  evaluateMedicationSafety,
  checkAllergies,
  checkRenalDosing,
  checkWeightBasedDosing,
  checkDuplicateTherapy,
  checkDoseRanges,
  checkInteractions,
  checkPregnancy,
  creatinineClearance,
  parseDoseAmount,
  parseFrequencyPerDay,
  SEVERITY,
  REQUIRES_OVERRIDE_REASON,
};
