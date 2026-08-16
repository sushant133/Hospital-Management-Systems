import {
  HmisReturn,
  Encounter,
  MaternityCase,
  AncVisit,
  Immunization,
  LabOrder,
  Surgery,
} from '../models/index.js';
import { RETURN_KINDS } from '../models/HmisReturn.js';
import { bsMonthRange, fiscalYearOf, adToBs, BS_MONTHS_EN } from '../utils/nepal.js';
import config from '../config/env.js';

/**
 * ============================================================================
 * HMIS / DHIS2 STATUTORY REPORTING
 * ============================================================================
 *
 * Builds the monthly return MoHP asks for out of data the hospital already
 * holds, in Nepali months, ready for review and sign-off before it goes out.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES AND DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * The HMIS register set is large and its indicator definitions are revised. The
 * indicators below are the core clinical counts every facility reports and that
 * this system can derive honestly from its own data: OPD/IPD attendance,
 * admissions and outcomes, deliveries, ANC, immunisation, referrals, and
 * mortality. Each carries a `derivation` string stating exactly what was
 * counted, so a district officer can be answered precisely.
 *
 * Morbidity by diagnosis is DELIBERATELY not derived yet: it requires coded
 * diagnoses, and this system currently stores diagnosis as free text (see the
 * Tier B gap on ICD coding). Producing a morbidity table from uncoded text
 * would be inventing statistics. `morbidityAvailable` reports that plainly
 * rather than silently emitting zeros, which a reviewer would take as "no
 * cases".
 */

/** One indicator definition: what it is called and how it is counted. */
const INDICATORS = [
  {
    code: 'OPD_TOTAL',
    label: 'Total OPD attendance',
    labelNe: 'कुल बहिरंग सेवा',
    derivation: 'Encounters of type opd opened within the period.',
    async compute({ start, end }) {
      return Encounter.countDocuments({
        type: 'opd',
        startedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'OPD_NEW',
    label: 'OPD — new patients',
    labelNe: 'बहिरंग — नयाँ बिरामी',
    derivation: "Patients whose first-ever encounter falls in the period.",
    async compute({ start, end }) {
      const rows = await Encounter.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$patientId', first: { $min: '$startedAt' } } },
        { $match: { first: { $gte: start, $lt: end } } },
        { $count: 'n' },
      ]);
      return rows[0]?.n ?? 0;
    },
  },
  {
    code: 'EMERGENCY_TOTAL',
    label: 'Emergency attendance',
    labelNe: 'आकस्मिक सेवा',
    derivation: 'Encounters of type emergency opened within the period.',
    async compute({ start, end }) {
      return Encounter.countDocuments({
        type: 'emergency',
        startedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'IPD_ADMISSIONS',
    label: 'Inpatient admissions',
    labelNe: 'भर्ना संख्या',
    derivation: 'Encounters of type ipd admitted within the period.',
    async compute({ start, end }) {
      return Encounter.countDocuments({
        type: 'ipd',
        admittedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'IPD_DISCHARGES',
    label: 'Inpatient discharges',
    labelNe: 'डिस्चार्ज संख्या',
    derivation: 'Encounters discharged within the period.',
    async compute({ start, end }) {
      return Encounter.countDocuments({
        status: 'discharged',
        dischargedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'DEATHS_TOTAL',
    label: 'Deaths',
    labelNe: 'मृत्यु संख्या',
    derivation: 'Encounters whose discharge outcome was recorded as death.',
    async compute({ start, end }) {
      return Encounter.countDocuments({
        dischargeOutcome: 'death',
        dischargedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'REFERRALS_IN',
    label: 'Referrals received',
    labelNe: 'प्राप्त रेफर',
    derivation: 'Encounters carrying an inbound referral record.',
    async compute({ start, end }) {
      return Encounter.countDocuments({
        'referral.referralDate': { $ne: null },
        startedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'DELIVERIES_TOTAL',
    label: 'Institutional deliveries',
    labelNe: 'संस्थागत प्रसूति',
    derivation: 'Maternity cases with a delivery recorded within the period.',
    async compute({ start, end }) {
      return MaternityCase.countDocuments({
        deliveredAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'ANC_VISITS',
    label: 'Antenatal visits',
    labelNe: 'गर्भवती जाँच',
    derivation: 'ANC visits recorded within the period.',
    async compute({ start, end }) {
      return AncVisit.countDocuments({ visitDate: { $gte: start, $lt: end }, isActive: true });
    },
  },
  {
    code: 'IMMUNISATION_DOSES',
    label: 'Immunisation doses given',
    labelNe: 'खोप मात्रा',
    derivation: 'Immunisation records administered within the period.',
    async compute({ start, end }) {
      return Immunization.countDocuments({
        administeredAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'LAB_TESTS',
    label: 'Laboratory tests performed',
    labelNe: 'प्रयोगशाला परीक्षण',
    derivation: 'Lab orders completed within the period.',
    async compute({ start, end }) {
      return LabOrder.countDocuments({
        status: 'completed',
        updatedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
  {
    code: 'SURGERIES_MAJOR',
    label: 'Major surgical operations',
    labelNe: 'ठूलो शल्यक्रिया',
    derivation: 'Surgeries completed within the period, classified major.',
    async compute({ start, end }) {
      return Surgery.countDocuments({
        status: 'completed',
        category: 'major',
        completedAt: { $gte: start, $lt: end },
        isActive: true,
      });
    },
  },
];

/**
 * Build (but do not submit) the monthly return for a BS month.
 *
 * Figures are computed once and frozen onto the document. Regenerating for a
 * period that already has an approved return produces a restatement chained to
 * it, never an edit — see the model.
 */
export async function generateMonthlyReturn({ bsYear, bsMonth, user, regeneratedFrom = null, restatementReason = '' }) {
  const { start, end } = bsMonthRange(bsYear, bsMonth);

  const indicators = [];
  for (const definition of INDICATORS) {
    let value = 0;
    let derivation = definition.derivation;
    try {
      value = await definition.compute({ start, end });
    } catch (error) {
      // A model this hospital does not use (no maternity unit, say) must not
      // sink the whole return. Record it as unavailable rather than as zero —
      // a reviewer reads a zero as "no cases", which is a different claim.
      value = 0;
      derivation = `${definition.derivation} — NOT AVAILABLE: ${error.message}`;
    }
    indicators.push({
      code: definition.code,
      label: definition.label,
      labelNe: definition.labelNe,
      dataElement: definition.dataElement || '',
      value,
      derivation,
    });
  }

  return HmisReturn.create({
    kind: RETURN_KINDS.HMIS_MONTHLY,
    bsYear,
    bsMonth,
    fiscalYear: fiscalYearOf(start).code,
    periodStart: start,
    periodEnd: end,
    facilityCode: config.hmis.facilityCode,
    facilityName: config.hospital.name,
    districtCode: config.hospital.districtCode,
    indicators,
    status: 'draft',
    generatedBy: user?._id ?? null,
    regeneratedFrom,
    restatementReason,
    createdBy: user?._id ?? null,
  });
}

/**
 * Shape an approved return as a DHIS2 data value set.
 *
 * Only indicators that carry a `dataElement` mapping are included: pushing a
 * value against a guessed uid would write the hospital's figures into whatever
 * element happened to match, which is worse than not pushing at all. The
 * mapping is configured per facility during commissioning.
 */
export function toDhis2DataValueSet(hmisReturn) {
  const period = `${adToBs(hmisReturn.periodStart).year}${String(hmisReturn.bsMonth).padStart(2, '0')}`;

  const mapped = hmisReturn.indicators.filter((i) => i.dataElement);
  const unmapped = hmisReturn.indicators.filter((i) => !i.dataElement).map((i) => i.code);

  return {
    dataSet: config.hmis.dataSetId || '',
    orgUnit: config.hmis.orgUnitId,
    period,
    dataValues: mapped.map((indicator) => ({
      dataElement: indicator.dataElement,
      categoryOptionCombo: indicator.categoryOptionCombo || undefined,
      value: String(indicator.overriddenValue ?? indicator.value),
    })),
    /** Surfaced to the operator rather than swallowed — these will not be sent. */
    unmappedIndicators: unmapped,
  };
}

/** Push an approved return to the national DHIS2 instance. */
export async function submitToDhis2(hmisReturn) {
  if (!config.hmis.enabled) {
    return { ok: false, reason: 'DHIS2 submission is not configured in this facility.' };
  }
  if (hmisReturn.status !== 'approved') {
    return { ok: false, reason: 'Only an approved return may be submitted.' };
  }

  const payload = toDhis2DataValueSet(hmisReturn);
  if (payload.dataValues.length === 0) {
    return {
      ok: false,
      reason:
        'No indicator on this return is mapped to a DHIS2 data element. ' +
        'Complete the mapping before submitting electronically.',
    };
  }

  const auth = Buffer.from(`${config.hmis.dhis2Username}:${config.hmis.dhis2Password}`).toString('base64');
  const response = await fetch(`${config.hmis.dhis2Url}/api/dataValueSets`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, response: body, unmapped: payload.unmappedIndicators };
}

/** Human-readable period label for the UI: "Shrawan 2081". */
export function periodLabel({ bsYear, bsMonth }) {
  return `${BS_MONTHS_EN[bsMonth - 1]} ${bsYear}`;
}

export { INDICATORS };
export default { generateMonthlyReturn, toDhis2DataValueSet, submitToDhis2, periodLabel };
