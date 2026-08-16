/**
 * Reference-range evaluation.
 *
 * Kept out of the controller so the flagging rules are testable in isolation and
 * so the PDF renderer and the API agree on what "abnormal" means.
 */

/**
 * Parse a lab-entered value into a number.
 * Handles the conventions techs actually type: '<0.01', '>1000', '1,200', '12.5'.
 * Returns null for qualitative values ('Negative', 'Trace').
 */
export function parseNumericValue(raw) {
  if (raw === null || raw === undefined) return null;

  const cleaned = String(raw).trim().replace(/,/g, '').replace(/^[<>≤≥]=?/, '');
  if (cleaned === '') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Human-readable range for the report column, e.g. '3.5 – 5.1' or '< 200'. */
export function formatReferenceRange(analyte) {
  if (!analyte) return '';

  const { refLow, refHigh, normalValue, expectedValues } = analyte;
  const hasLow = refLow !== null && refLow !== undefined;
  const hasHigh = refHigh !== null && refHigh !== undefined;

  if (hasLow && hasHigh) return `${refLow} – ${refHigh}`;
  if (hasHigh) return `< ${refHigh}`;
  if (hasLow) return `> ${refLow}`;
  if (normalValue) return normalValue;
  if (expectedValues?.length) return expectedValues.join(' / ');
  return '';
}

/**
 * Decide the flag for one value against its catalogue analyte.
 *
 * Critical thresholds win over the plain reference range: a value can be both
 * "high" and "critical-high", and the critical designation is the one that
 * needs to reach a clinician.
 */
export function evaluateFlag(analyte, rawValue) {
  const numeric = parseNumericValue(rawValue);

  // Qualitative analyte — compare against the expected normal string.
  if (analyte?.valueType === 'text' || numeric === null) {
    const normal = (analyte?.normalValue ?? '').trim().toLowerCase();
    if (!normal) return 'normal'; // nothing to compare against
    const entered = String(rawValue ?? '').trim().toLowerCase();
    return entered === normal ? 'normal' : 'abnormal';
  }

  const { refLow, refHigh, criticalLow, criticalHigh } = analyte ?? {};

  if (criticalLow !== null && criticalLow !== undefined && numeric <= criticalLow) {
    return 'critical-low';
  }
  if (criticalHigh !== null && criticalHigh !== undefined && numeric >= criticalHigh) {
    return 'critical-high';
  }
  if (refLow !== null && refLow !== undefined && numeric < refLow) return 'low';
  if (refHigh !== null && refHigh !== undefined && numeric > refHigh) return 'high';

  return 'normal';
}

/**
 * Build the stored `values` array for a result from the tech's raw entries.
 *
 * Snapshots the reference range onto each value so the result stays
 * reproducible if the catalogue is edited later.
 *
 * @param {object}   labTest  the catalogue document (with analytes)
 * @param {object[]} entries  [{ analyteCode, value, notes }]
 */
export function buildResultValues(labTest, entries = []) {
  const analytesByCode = new Map(
    (labTest.analytes ?? []).map((analyte) => [analyte.code.toUpperCase(), analyte]),
  );

  return entries.map((entry) => {
    const analyte = analytesByCode.get(String(entry.analyteCode).toUpperCase());

    if (!analyte) {
      // Should be unreachable — the controller validates codes first.
      throw new Error(`Unknown analyte "${entry.analyteCode}" for test ${labTest.code}`);
    }

    return {
      analyteCode: analyte.code,
      analyteName: analyte.name,
      value: String(entry.value).trim(),
      numericValue: parseNumericValue(entry.value),
      unit: analyte.unit ?? '',
      refLow: analyte.refLow ?? null,
      refHigh: analyte.refHigh ?? null,
      referenceRange: formatReferenceRange(analyte),
      flag: evaluateFlag(analyte, entry.value),
      notes: entry.notes ?? '',
    };
  });
}

/** Short label used on the PDF and in list badges. */
export function flagLabel(flag) {
  return (
    {
      normal: '',
      low: 'LOW',
      high: 'HIGH',
      'critical-low': 'CRITICAL LOW',
      'critical-high': 'CRITICAL HIGH',
      abnormal: 'ABNORMAL',
    }[flag] ?? ''
  );
}
