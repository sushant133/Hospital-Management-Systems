/**
 * Reference-range evaluation for observations.
 *
 * Kept out of the controller for the same reason labService is: the rules must
 * be testable on their own, and the timeline, the chart and the API must all
 * agree on what "abnormal" means.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CLINICAL CAVEAT — read before relying on these flags
 * ---------------------------------------------------------------------------
 * The ranges below are **typical resting adult values**. They are a starting
 * point for a deployment to review and sign off, exactly like the lab
 * catalogue's reference ranges, and they are wrong for several populations:
 *
 *   - Paediatrics. Normal pulse and respiratory rate vary enormously with age;
 *     a healthy newborn breathing at 40/min would be flagged critical here.
 *   - Pregnancy, and patients on rate-controlling medication.
 *   - Patients with chronic disease whose own baseline sits outside these
 *     ranges (COPD and target SpO2 being the obvious case).
 *
 * A flag is a prompt to look, not a diagnosis, and this is deliberately NOT an
 * early-warning score: it does not aggregate, weight or escalate. Age-banded
 * ranges belong here before this is used on a paediatric ward.
 */

/**
 * [criticalLow, low, high, criticalHigh]. A null bound means "no threshold on
 * that side" — nobody is flagged for a low pain score.
 */
const RANGES = {
  temperatureC: { criticalLow: 35, low: 36.1, high: 37.9, criticalHigh: 39.5 },
  pulseBpm: { criticalLow: 40, low: 60, high: 100, criticalHigh: 130 },
  respiratoryRate: { criticalLow: 8, low: 12, high: 20, criticalHigh: 30 },
  systolicBp: { criticalLow: 90, low: 100, high: 140, criticalHigh: 180 },
  diastolicBp: { criticalLow: 50, low: 60, high: 90, criticalHigh: 120 },
  spo2: { criticalLow: 90, low: 94, high: null, criticalHigh: null },
  painScore: { criticalLow: null, low: null, high: 6, criticalHigh: 8 },
};

/** Human labels for the UI, so the wording is defined once. */
export const FLAG_LABELS = Object.freeze({
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  'critical-low': 'Critically low',
  'critical-high': 'Critically high',
});

/** Evaluate one measurement. Returns null when the field has no range defined. */
export function flagFor(field, value) {
  const range = RANGES[field];
  if (!range || value === undefined || value === null || Number.isNaN(Number(value))) return null;

  const n = Number(value);

  if (range.criticalLow !== null && n < range.criticalLow) return 'critical-low';
  if (range.criticalHigh !== null && n > range.criticalHigh) return 'critical-high';
  if (range.low !== null && n < range.low) return 'low';
  if (range.high !== null && n > range.high) return 'high';
  return 'normal';
}

/** Body mass index, rounded to one decimal. Null unless both inputs are present. */
export function calculateBmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const metres = Number(heightCm) / 100;
  if (metres <= 0) return null;
  return Math.round((Number(weightKg) / (metres * metres)) * 10) / 10;
}

/**
 * Decorate a vitals document in place: per-field flags, the abnormal/critical
 * roll-ups the timeline filters on, and BMI.
 */
export function evaluateVitals(doc) {
  const flags = new Map();
  let hasAbnormal = false;
  let hasCritical = false;

  for (const field of Object.keys(RANGES)) {
    const flag = flagFor(field, doc[field]);
    if (!flag) continue;

    flags.set(field, flag);
    if (flag !== 'normal') hasAbnormal = true;
    if (flag.startsWith('critical')) hasCritical = true;
  }

  doc.flags = flags;
  doc.hasAbnormal = hasAbnormal;
  doc.hasCritical = hasCritical;
  doc.bmi = calculateBmi(doc.weightKg, doc.heightCm);

  return doc;
}

/** The ranges themselves, for the UI to show alongside a reading. */
export function referenceRanges() {
  return RANGES;
}

export default { evaluateVitals, flagFor, calculateBmi, referenceRanges, FLAG_LABELS };
