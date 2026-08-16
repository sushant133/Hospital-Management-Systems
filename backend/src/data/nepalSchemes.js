import { COVERAGE_MODES } from '../models/Scheme.js';
import { ID_TYPES, DISABILITY_CATEGORIES } from '../utils/nepal.js';

/**
 * ============================================================================
 * SEED DATA — NEPAL'S GOVERNMENT HEALTH SCHEMES
 * ============================================================================
 *
 * ⚠ VERIFY EVERY FIGURE BEFORE GOING LIVE.
 *
 * Ceilings, incentive amounts, covered-condition lists and eligibility ages are
 * set by annual budget and by MoHP directives, and they move. What is encoded
 * here is the *shape* of each programme — which is stable — with
 * current-at-writing values as a starting point. They are seeded into the
 * database precisely so the hospital's accounts office can correct them without
 * a code release; `authorityReference` on each row is where to record the
 * circular the current numbers come from.
 *
 * The `diagnosis-in` and `service-in` rules reference ICD codes and internal
 * service codes. Those lists are indicative: they need mapping against this
 * hospital's own service catalogue during commissioning, which is a data task
 * for the MRD/billing team rather than something that can be shipped blind.
 */

export const NEPAL_SCHEMES = [
  {
    code: 'senior-citizen',
    name: 'Senior Citizen Free Health Service',
    nameNe: 'ज्येष्ठ नागरिक निःशुल्क स्वास्थ्य सेवा',
    description:
      'Free basic health services at public facilities for citizens aged 70 and above, ' +
      'on production of a senior citizen card.',
    coverageMode: COVERAGE_MODES.FULL,
    ceilingAmount: 100000,
    ceilingPeriod: 'fiscal-year',
    coveredSourceTypes: ['consultation', 'lab', 'radiology', 'pharmacy', 'procedure', 'bed'],
    eligibility: [
      { field: 'age-min', value: 70, description: 'Aged 70 or above' },
      {
        field: 'has-identifier',
        value: ID_TYPES.SENIOR_CITIZEN_CARD,
        description: 'Holds a senior citizen card',
      },
    ],
    claimRoute: 'mohp',
    claimWindowDays: 90,
    requiresDocument: true,
    documentLabel: 'Senior citizen card',
    authorityReference: 'Senior Citizens Act / annual MoHP directive — confirm current terms',
  },

  {
    code: 'bipanna-nagarik',
    name: 'Bipanna Nagarik Aushadhi Upachar Kosh',
    nameNe: 'विपन्न नागरिक औषधि उपचार कोष',
    description:
      'Treatment fund for impoverished citizens covering specified severe conditions — ' +
      'cancer, heart disease, kidney disease, spinal injury, head injury, ' +
      "Alzheimer's/Parkinson's and sickle cell anaemia.",
    coverageMode: COVERAGE_MODES.FULL,
    ceilingAmount: 100000,
    ceilingPeriod: 'lifetime',
    eligibility: [
      {
        field: 'diagnosis-in',
        // Indicative ICD-10 chapters; map to this hospital's coded diagnoses
        // during commissioning.
        value: ['C00-C97', 'I00-I99', 'N17-N19', 'S14', 'S24', 'S34', 'S06', 'G30', 'G20', 'D57'],
        description: 'Diagnosis is one of the fund’s listed conditions',
      },
    ],
    claimRoute: 'mohp',
    claimWindowDays: 60,
    requiresDocument: true,
    documentLabel: 'Recommendation letter / poverty identification',
    authorityReference: 'MoHP Bipanna Nagarik guideline — confirm current ceiling and condition list',
  },

  {
    code: 'aama-surakshya-delivery',
    name: 'Aama Surakshya — Institutional Delivery',
    nameNe: 'आमा सुरक्षा कार्यक्रम — संस्थागत प्रसूति',
    description:
      'Free institutional delivery. The facility claims the delivery cost; the mother ' +
      'separately receives a transport incentive.',
    coverageMode: COVERAGE_MODES.PACKAGE_RATE,
    ceilingPeriod: 'episode',
    coveredSourceTypes: ['procedure', 'bed', 'pharmacy'],
    coveredServiceCodes: ['DELIVERY-NORMAL', 'DELIVERY-CS', 'DELIVERY-COMPLICATED'],
    eligibility: [{ field: 'gender', value: 'female', description: 'Applies to mothers' }],
    claimRoute: 'mohp',
    claimWindowDays: 45,
    requiresDocument: false,
    authorityReference: 'Safe Motherhood Programme — confirm current package rates by facility level',
  },

  {
    code: 'aama-transport-incentive',
    name: 'Aama Surakshya — Transport Incentive',
    nameNe: 'आमा सुरक्षा — यातायात खर्च',
    description:
      'Fixed cash incentive paid to a mother for an institutional delivery. The amount ' +
      'differs by ecological zone (mountain / hill / terai) and is set per facility.',
    coverageMode: COVERAGE_MODES.FLAT_PER_EPISODE,
    // Set the correct zone amount for THIS facility during commissioning.
    flatAmount: 1000,
    ceilingPeriod: 'episode',
    eligibility: [{ field: 'gender', value: 'female', description: 'Applies to mothers' }],
    claimRoute: 'mohp',
    claimWindowDays: 45,
    requiresDocument: false,
    authorityReference: 'Safe Motherhood Programme — mountain 3000 / hill 2000 / terai 1000 (verify)',
  },

  {
    code: 'anc-visit-incentive',
    name: 'Four ANC Visit Incentive',
    nameNe: 'चार पटक गर्भवती जाँच प्रोत्साहन',
    description:
      'Incentive paid to a mother who completes four antenatal visits at the recommended ' +
      'gestational milestones.',
    coverageMode: COVERAGE_MODES.FLAT_PER_EPISODE,
    flatAmount: 800,
    ceilingPeriod: 'episode',
    eligibility: [{ field: 'gender', value: 'female', description: 'Applies to mothers' }],
    claimRoute: 'mohp',
    claimWindowDays: 45,
    requiresDocument: false,
    authorityReference: 'Safe Motherhood Programme — confirm current amount',
  },

  {
    code: 'free-dialysis',
    name: 'Free Haemodialysis Programme',
    nameNe: 'निःशुल्क मृगौला डायलाइसिस',
    description:
      'Government-funded haemodialysis for citizens with end-stage renal disease, ' +
      'claimed per session against the published rate.',
    coverageMode: COVERAGE_MODES.PACKAGE_RATE,
    ceilingPeriod: 'none',
    coveredServiceCodes: ['DIALYSIS-HD', 'DIALYSIS-HD-CONSUMABLES'],
    eligibility: [
      {
        field: 'service-in',
        value: ['DIALYSIS-HD'],
        description: 'A dialysis session is on the bill',
      },
    ],
    claimRoute: 'mohp',
    claimWindowDays: 30,
    requiresDocument: true,
    documentLabel: 'Dialysis programme registration',
    authorityReference: 'MoHP free dialysis directive — confirm current per-session rate',
  },

  {
    code: 'disability-ka-kha',
    name: 'Disability Free Health Service (Ka / Kha)',
    nameNe: 'अपाङ्गता निःशुल्क स्वास्थ्य सेवा (क / ख)',
    description:
      'Free health services for holders of a red (Ka) or blue (Kha) disability card — ' +
      'the complete and severe disability categories.',
    coverageMode: COVERAGE_MODES.FULL,
    ceilingAmount: 100000,
    ceilingPeriod: 'fiscal-year',
    eligibility: [
      {
        field: 'identifier-category',
        value: [DISABILITY_CATEGORIES.KA, DISABILITY_CATEGORIES.KHA],
        description: 'Holds a Ka (red) or Kha (blue) disability card',
      },
    ],
    claimRoute: 'mohp',
    claimWindowDays: 90,
    requiresDocument: true,
    documentLabel: 'Disability identity card',
    authorityReference: 'Disability Rights Act — confirm current entitlement scope',
  },

  {
    code: 'fchv',
    name: 'Female Community Health Volunteer Entitlement',
    nameNe: 'महिला स्वास्थ्य स्वयंसेविका सुविधा',
    description: 'Free health services for serving female community health volunteers.',
    coverageMode: COVERAGE_MODES.FULL,
    ceilingAmount: 50000,
    ceilingPeriod: 'fiscal-year',
    eligibility: [{ field: 'gender', value: 'female', description: 'FCHVs are women' }],
    claimRoute: 'local',
    claimWindowDays: 90,
    requiresDocument: true,
    documentLabel: 'FCHV identity card',
    authorityReference: 'Local level FCHV policy — confirm with the palika',
  },

  {
    code: 'conflict-victim',
    name: 'Martyrs’ Families and Conflict Victims',
    nameNe: 'शहीद परिवार तथा द्वन्द्वपीडित',
    description:
      'Free treatment for the families of martyrs and for people injured in the conflict, ' +
      'on production of the relevant identity card.',
    coverageMode: COVERAGE_MODES.FULL,
    ceilingAmount: 100000,
    ceilingPeriod: 'fiscal-year',
    claimRoute: 'mohp',
    claimWindowDays: 90,
    requiresDocument: true,
    documentLabel: 'Martyr family / conflict victim identity card',
    authorityReference: 'MoHP directive — confirm current terms',
  },
];

export default NEPAL_SCHEMES;
