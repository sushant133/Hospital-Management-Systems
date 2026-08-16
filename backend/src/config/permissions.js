import { ROLES, ROLE_VALUES } from './roles.js';

/**
 * ============================================================================
 * THE PERMISSION MATRIX — the single source of truth for authorization.
 * ============================================================================
 *
 * Every protected route in the system is gated by `requirePermission(module,
 * action)`, which reads this table. There are no role checks scattered through
 * controllers: if you want to change who can do what, you change this file and
 * nothing else.
 *
 * Shape:  MODULE -> ACTION -> [roles allowed]
 *
 * Read it as a grid. `patients.create: [RECEPTIONIST, DOCTOR, NURSE]` means
 * "a receptionist, doctor or nurse may register a patient".
 *
 * ---------------------------------------------------------------------------
 * ADMIN IS IMPLICIT
 * ---------------------------------------------------------------------------
 * `admin` is deliberately absent from every row. `can()` grants admin every
 * permission unconditionally (see ADMIN_HAS_FULL_ACCESS below). This keeps the
 * table readable — without it, `admin` would appear in all ~130 rows and the
 * interesting distinctions would be buried. `permissionsForRole('admin')` still
 * expands to the complete explicit list, so the client, the docs and any audit
 * see the full grant.
 *
 * To take something away from admin, remove the short-circuit and list roles
 * explicitly — the rest of the system needs no change.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS
 * ---------------------------------------------------------------------------
 * - `view` covers both list and detail reads.
 * - `create` / `edit` / `delete` are the standard triple. `delete` always means
 *   the soft delete (isActive:false) — nothing is ever physically removed.
 * - `restore` is separated from `edit` because undoing a deletion is a
 *   privileged correction, not an ordinary update.
 * - Extra verbs (`verify`, `dispense`, `approveDiscount`) are used when a
 *   step needs a narrower gate than `edit`.
 */

/** Grant admin every permission without listing it in every row. */
const ADMIN_HAS_FULL_ACCESS = true;

export const MODULES = Object.freeze({
  // Phase 1 — patient master index & facility reference data
  PATIENTS: 'patients',
  DEPARTMENTS: 'departments',
  WARDS: 'wards',
  BEDS: 'beds',
  // Phase 2-4 — scheduling, clinical record, admissions
  APPOINTMENTS: 'appointments',
  ENCOUNTERS: 'encounters',
  CLINICAL_NOTES: 'clinicalNotes',
  // Phase 5 — staff & HR
  STAFF: 'staff',
  ATTENDANCE: 'attendance',
  // Phase 6-7 — diagnostics
  LAB_TESTS: 'labTests',
  LAB_ORDERS: 'labOrders',
  LAB_RESULTS: 'labResults',
  RADIOLOGY_EXAMS: 'radiologyExams',
  RADIOLOGY_ORDERS: 'radiologyOrders',
  RADIOLOGY_RESULTS: 'radiologyResults',
  // Phase 8-9 — pharmacy & stores
  PRESCRIPTIONS: 'prescriptions',
  DRUGS: 'drugs',
  DRUG_BATCHES: 'drugBatches',
  DISPENSING: 'dispensing',
  INVENTORY: 'inventory',
  // Phase 10-11 — money
  BILLING: 'billing',
  INVOICES: 'invoices',
  PAYMENTS: 'payments',
  INSURANCE_PROVIDERS: 'insuranceProviders',
  PATIENT_POLICIES: 'patientPolicies',
  PRE_AUTHORIZATIONS: 'preAuthorizations',
  CLAIMS: 'claims',
  // Phase 12-13 — payroll, dashboards
  PAYROLL: 'payroll',
  REPORTS: 'reports',
  // Phase 0 — compliance
  AUDIT_LOGS: 'auditLogs',
  // Tier 1 — ward-hard clinical, imaging store, notifications
  MEDICATION_ADMIN: 'medicationAdmin',
  THEATRE: 'theatre',
  TRIAGE: 'triage',
  NOTIFICATIONS: 'notifications',
  BILLING_PACKAGES: 'billingPackages',
  DICOM: 'dicom',
  // Tier 2 — mid-market
  PORTAL: 'portal',
  FHIR: 'fhir',
  MATERNITY: 'maternity',
  IMMUNIZATIONS: 'immunizations',
  BLOOD_BANK: 'bloodBank',
  PURCHASE: 'purchase',
  SUPPLIERS: 'suppliers',
  // Tier 3 — enterprise-shaped slices
  FACILITIES: 'facilities',
  CDS: 'cds',
  HIE: 'hie',
  WAREHOUSE: 'warehouse',
  DEVICES: 'devices',
  // Tier A — Nepal localisation
  // Tier B — clinical safety and legal records
  TERMINOLOGY: 'terminology',
  CRITICAL_ALERTS: 'criticalAlerts',
  CONTROLLED_DRUGS: 'controlledDrugs',
  MEDICO_LEGAL: 'medicoLegal',
  DEATH_RECORDS: 'deathRecords',
  BIRTH_RECORDS: 'birthRecords',
  PROBLEMS: 'problems',
  CARE_PLANS: 'carePlans',
  INFECTION_CONTROL: 'infectionControl',
  ANTIBIOTIC_APPROVALS: 'antibioticApprovals',
  TRANSFUSIONS: 'transfusions',
  INCIDENTS: 'incidents',
  COMPLAINTS: 'complaints',
  // Tier C — operational
  REFERRALS: 'referrals',
  OPD_QUEUE: 'opdQueue',
  AMBULANCE: 'ambulance',
  DIALYSIS: 'dialysis',
  MEDICAL_RECORDS: 'medicalRecords',
  DIETARY: 'dietary',
  HOUSEKEEPING: 'housekeeping',
  WASTE: 'waste',
  CSSD: 'cssd',
  ASSETS: 'assets',
  THERAPY: 'therapy',
  MORTUARY: 'mortuary',
  TELEMEDICINE: 'telemedicine',
  // Tier A — Nepal localisation
  NEPAL_REFERENCE: 'nepalReference',
  SCHEMES: 'schemes',
  ENTITLEMENTS: 'entitlements',
  SCHEME_CLAIMS: 'schemeClaims',
  HIB: 'hib',
  CREDIT_NOTES: 'creditNotes',
  GATEWAY_PAYMENTS: 'gatewayPayments',
  SMS: 'sms',
  HMIS: 'hmis',
});

const {
  DOCTOR,
  NURSE,
  RECEPTIONIST,
  LAB_TECH,
  RADIOLOGIST,
  PHARMACIST,
  ACCOUNTANT,
  STAFF,
} = ROLES;

/** Every role that is not `admin` — used for hospital-wide reference reads. */
const EVERY_ROLE = ROLE_VALUES.filter((role) => role !== ROLES.ADMIN);

/**
 * Roles that may look up a patient. Broader than the clinical set: the lab,
 * radiology, pharmacy and billing desks all need to attach their work to a
 * patient record, which means they must be able to find one.
 */
const PATIENT_READERS = [
  DOCTOR,
  NURSE,
  RECEPTIONIST,
  LAB_TECH,
  RADIOLOGIST,
  PHARMACIST,
  ACCOUNTANT,
];

export const PERMISSION_MATRIX = Object.freeze({
  // ==========================================================================
  // PATIENT MASTER INDEX
  // ==========================================================================
  [MODULES.PATIENTS]: {
    view: PATIENT_READERS,
    create: [RECEPTIONIST, DOCTOR, NURSE],
    edit: [RECEPTIONIST, DOCTOR, NURSE],
    delete: [RECEPTIONIST],
    restore: [],
    /** Run the MPI duplicate search without registering anyone. */
    checkDuplicates: [RECEPTIONIST, DOCTOR, NURSE],
    /** Register despite a flagged duplicate — a deliberate, audited override. */
    overrideDuplicate: [RECEPTIONIST],
    /** Merge two records into one. Irreversible in effect; admin only. */
    merge: [],
    /** Allergies, chronic conditions, past surgeries — clinical, not clerical. */
    viewMedicalHistory: [DOCTOR, NURSE, PHARMACIST],
    editMedicalHistory: [DOCTOR, NURSE],
  },

  // ==========================================================================
  // FACILITY REFERENCE DATA
  // ==========================================================================
  [MODULES.DEPARTMENTS]: {
    view: EVERY_ROLE,
    create: [],
    edit: [],
    delete: [],
    restore: [],
  },

  [MODULES.WARDS]: {
    view: EVERY_ROLE,
    create: [],
    edit: [],
    delete: [],
    restore: [],
  },

  [MODULES.BEDS]: {
    view: EVERY_ROLE,
    create: [],
    edit: [],
    delete: [],
    restore: [],
    /** Occupied / cleaning / maintenance transitions are ward-floor work. */
    changeStatus: [NURSE],
    /** Admitting a patient into a specific bed. */
    assign: [NURSE, DOCTOR, RECEPTIONIST],
  },

  // ==========================================================================
  // SCHEDULING & THE CLINICAL RECORD
  // ==========================================================================
  [MODULES.APPOINTMENTS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [RECEPTIONIST, DOCTOR, NURSE],
    /** Also covers rescheduling — same people, and the reason is captured either way. */
    edit: [RECEPTIONIST, DOCTOR, NURSE],
    delete: [RECEPTIONIST],
    /** Turning a booking into a live encounter at the front desk. */
    checkIn: [RECEPTIONIST, NURSE],
    cancel: [RECEPTIONIST, DOCTOR, NURSE],
    /**
     * Marking a patient absent has consequences (it closes the booking and
     * counts against the patient), so it is gated apart from ordinary edits.
     */
    markNoShow: [RECEPTIONIST, NURSE, DOCTOR],
    /**
     * Publishing the weekly clinic windows that slots are generated from.
     * Doctors set their own; reception maintains the schedule on their behalf.
     */
    manageAvailability: [DOCTOR, RECEPTIONIST],
  },

  [MODULES.ENCOUNTERS]: {
    view: PATIENT_READERS,
    create: [RECEPTIONIST, DOCTOR, NURSE],
    edit: [DOCTOR, NURSE],
    /** Cancelling a visit that should never have been opened. */
    delete: [DOCTOR],
    restore: [],
    /** Recording observations against an open encounter. */
    recordVitals: [NURSE, DOCTOR],
    /**
     * Ward rounds — the structured nursing check on an admitted patient.
     * Narrower than `edit`: performing a round is not editing the visit.
     */
    recordRound: [NURSE, DOCTOR],
    /** Discharge / close-out is a clinical sign-off. */
    close: [DOCTOR],
  },

  /**
   * Clinical notes are append-only: there is deliberately no `edit` or
   * `delete` action. A correction is a new `amend` entry that supersedes the
   * previous one while both remain readable.
   */
  [MODULES.CLINICAL_NOTES]: {
    view: [DOCTOR, NURSE],
    create: [DOCTOR, NURSE],
    amend: [DOCTOR, NURSE],
  },

  // ==========================================================================
  // STAFF & HR
  // ==========================================================================
  [MODULES.STAFF]: {
    view: [],
    create: [],
    edit: [],
    delete: [],
    restore: [],
    resetPassword: [],
    /** The staff directory — names, roles, extensions. No employment data. */
    viewDirectory: EVERY_ROLE,
  },

  [MODULES.ATTENDANCE]: {
    /** Anyone's attendance record. Own attendance needs no permission. */
    view: [],
    create: [],
    edit: [],
    delete: [],
    /** Clocking yourself in and out. */
    recordOwn: EVERY_ROLE,
    /** Publishing the shift roster. */
    manageShifts: [],
  },

  // ==========================================================================
  // LABORATORY
  // ==========================================================================
  [MODULES.LAB_TESTS]: {
    view: [DOCTOR, NURSE, LAB_TECH, RECEPTIONIST, ACCOUNTANT],
    create: [],
    edit: [],
    delete: [],
    restore: [],
  },

  [MODULES.LAB_ORDERS]: {
    view: [DOCTOR, NURSE, LAB_TECH, ACCOUNTANT],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR, LAB_TECH],
    delete: [],
    /** Specimen collection. */
    collect: [LAB_TECH, NURSE],
    /** Moving a collected specimen onto the bench. */
    process: [LAB_TECH],
    cancel: [DOCTOR, LAB_TECH],
    downloadReport: [DOCTOR, NURSE, LAB_TECH],
  },

  [MODULES.LAB_RESULTS]: {
    view: [DOCTOR, NURSE, LAB_TECH],
    /** Entering values — produces a preliminary (unsigned) result. */
    create: [LAB_TECH],
    /** The sign-off gate: only a verified result reaches the chart. */
    verify: [LAB_TECH],
    /** Correcting an already-verified result. Requires a reason; appends. */
    amend: [LAB_TECH],
  },

  // ==========================================================================
  // RADIOLOGY
  // ==========================================================================
  [MODULES.RADIOLOGY_EXAMS]: {
    view: [DOCTOR, NURSE, RADIOLOGIST, RECEPTIONIST, ACCOUNTANT],
    create: [],
    edit: [],
    delete: [],
    restore: [],
  },

  [MODULES.RADIOLOGY_ORDERS]: {
    view: [DOCTOR, NURSE, RADIOLOGIST, ACCOUNTANT],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR, RADIOLOGIST],
    delete: [],
    schedule: [RADIOLOGIST, RECEPTIONIST],
    cancel: [DOCTOR, RADIOLOGIST],
    downloadReport: [DOCTOR, NURSE, RADIOLOGIST],
  },

  [MODULES.RADIOLOGY_RESULTS]: {
    view: [DOCTOR, NURSE, RADIOLOGIST],
    create: [RADIOLOGIST],
    /** Radiologist sign-off on findings + impression. */
    verify: [RADIOLOGIST],
    amend: [RADIOLOGIST],
    /** Uploading the image files against a report. */
    attachImages: [RADIOLOGIST],
  },

  // ==========================================================================
  // PHARMACY
  // ==========================================================================
  [MODULES.PRESCRIPTIONS]: {
    view: [DOCTOR, NURSE, PHARMACIST],
    create: [DOCTOR],
    edit: [DOCTOR],
    delete: [],
    cancel: [DOCTOR, PHARMACIST],
  },

  /** The drug master — formulary entries, not stock. */
  [MODULES.DRUGS]: {
    view: [DOCTOR, NURSE, PHARMACIST, ACCOUNTANT],
    create: [PHARMACIST],
    edit: [PHARMACIST],
    delete: [PHARMACIST],
    restore: [],
  },

  /** Batch-level stock with expiry dates. */
  [MODULES.DRUG_BATCHES]: {
    view: [PHARMACIST, ACCOUNTANT, NURSE],
    /** Goods receipt. */
    create: [PHARMACIST],
    edit: [PHARMACIST],
    delete: [],
    /** Writing off expired or damaged stock. */
    adjust: [PHARMACIST],
  },

  [MODULES.DISPENSING]: {
    view: [PHARMACIST, DOCTOR, NURSE],
    /** FEFO batch selection + allergy check happen here. */
    create: [PHARMACIST],
    return: [PHARMACIST],
    /** Dispensing anyway after an allergy warning — audited. */
    overrideAllergyWarning: [PHARMACIST],
  },

  // ==========================================================================
  // GENERAL INVENTORY (non-drug)
  // ==========================================================================
  [MODULES.INVENTORY]: {
    view: [ACCOUNTANT, NURSE, PHARMACIST, RECEPTIONIST, STAFF],
    create: [],
    edit: [],
    delete: [],
    restore: [],
    /** Receipts, issues to departments, adjustments, returns. */
    transact: [NURSE, PHARMACIST, STAFF],
  },

  // ==========================================================================
  // BILLING
  // ==========================================================================
  /** The shared charge ledger every revenue module writes into. */
  [MODULES.BILLING]: {
    view: [ACCOUNTANT, RECEPTIONIST, DOCTOR],
    /** Manual charges (procedures, consumables) outside the auto feeds. */
    create: [ACCOUNTANT, RECEPTIONIST],
    edit: [ACCOUNTANT],
    cancel: [ACCOUNTANT],
  },

  [MODULES.INVOICES]: {
    view: [ACCOUNTANT, RECEPTIONIST, DOCTOR],
    create: [ACCOUNTANT, RECEPTIONIST],
    edit: [ACCOUNTANT],
    delete: [],
    /** Requesting a discount on a line or invoice. */
    applyDiscount: [ACCOUNTANT, RECEPTIONIST],
    /** Authorising it. Deliberately narrower than applying — admin only. */
    approveDiscount: [],
    /**
     * Abandoning a DRAFT invoice.
     *
     * There is no permission to reverse an *issued* one, because no role may.
     * An issued invoice carries a number from an unbroken fiscal-year sequence
     * and has been handed to a patient; the only lawful reversal is a credit
     * note (MODULES.CREDIT_NOTES). Replaces the former `void` action.
     */
    cancel: [ACCOUNTANT],
  },

  [MODULES.PAYMENTS]: {
    view: [ACCOUNTANT, RECEPTIONIST],
    /** Full or partial payment against an invoice. */
    create: [ACCOUNTANT, RECEPTIONIST],
    /** Refunds and credit notes reverse money that has already moved. */
    refund: [ACCOUNTANT],
  },

  // ==========================================================================
  // INSURANCE
  // ==========================================================================
  [MODULES.INSURANCE_PROVIDERS]: {
    view: [ACCOUNTANT, RECEPTIONIST, DOCTOR],
    create: [ACCOUNTANT],
    edit: [ACCOUNTANT],
    delete: [],
    restore: [],
  },

  [MODULES.PATIENT_POLICIES]: {
    view: [ACCOUNTANT, RECEPTIONIST, DOCTOR],
    create: [RECEPTIONIST, ACCOUNTANT],
    edit: [RECEPTIONIST, ACCOUNTANT],
    delete: [ACCOUNTANT],
    /** Confirming the policy is live and the patient is covered. */
    verifyEligibility: [RECEPTIONIST, ACCOUNTANT],
  },

  [MODULES.PRE_AUTHORIZATIONS]: {
    view: [ACCOUNTANT, RECEPTIONIST, DOCTOR],
    create: [RECEPTIONIST, ACCOUNTANT],
    edit: [ACCOUNTANT, RECEPTIONIST],
    /** Sending the request to the insurer. */
    submit: [ACCOUNTANT],
    /** Recording the insurer's decision. */
    recordDecision: [ACCOUNTANT],
  },

  [MODULES.CLAIMS]: {
    view: [ACCOUNTANT, RECEPTIONIST],
    create: [ACCOUNTANT],
    edit: [ACCOUNTANT],
    submit: [ACCOUNTANT],
    /** Settlement, partial settlement, rejection, resubmission. */
    recordDecision: [ACCOUNTANT],
  },

  // ==========================================================================
  // PAYROLL — kept separate from patient billing
  // ==========================================================================
  [MODULES.PAYROLL]: {
    /** Anyone's payslip. Own payslip needs no permission. */
    view: [ACCOUNTANT],
    /** Opening a monthly run. */
    create: [ACCOUNTANT],
    edit: [ACCOUNTANT],
    /** Signing off a run so it can be paid. Admin only. */
    approve: [],
    /** Own payslip. */
    viewOwn: EVERY_ROLE,
  },

  // ==========================================================================
  // DASHBOARDS & COMPLIANCE
  // ==========================================================================
  [MODULES.REPORTS]: {
    /** Occupancy, patient flow, department KPIs. */
    viewOperational: [DOCTOR, NURSE, ACCOUNTANT],
    /** Revenue, outstanding balances, inventory burn. */
    viewFinancial: [ACCOUNTANT],
    /** Clinical outcome and diagnostics reports. */
    viewClinical: [DOCTOR],
    export: [ACCOUNTANT],
  },

  [MODULES.AUDIT_LOGS]: {
    /** The compliance trail. Admin only — it is the record of everyone else. */
    view: [],
    export: [],
  },

  [MODULES.MEDICATION_ADMIN]: {
    view: [DOCTOR, NURSE],
    /** Charting a dose as given, held or refused. */
    create: [NURSE, DOCTOR],
    hold: [NURSE, DOCTOR],
  },

  [MODULES.THEATRE]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [DOCTOR, RECEPTIONIST],
    edit: [DOCTOR, NURSE],
    start: [DOCTOR, NURSE],
    complete: [DOCTOR],
    cancel: [DOCTOR, RECEPTIONIST],
  },

  [MODULES.TRIAGE]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [NURSE, RECEPTIONIST, DOCTOR],
    edit: [NURSE, DOCTOR],
    assign: [NURSE, DOCTOR],
  },

  [MODULES.NOTIFICATIONS]: {
    viewOwn: EVERY_ROLE,
  },

  [MODULES.BILLING_PACKAGES]: {
    view: [ACCOUNTANT, RECEPTIONIST, DOCTOR],
    create: [ACCOUNTANT],
    edit: [ACCOUNTANT],
    delete: [],
    apply: [ACCOUNTANT, RECEPTIONIST],
  },

  [MODULES.DICOM]: {
    view: [DOCTOR, NURSE, RADIOLOGIST],
    create: [RADIOLOGIST],
    download: [DOCTOR, NURSE, RADIOLOGIST],
  },

  [MODULES.PORTAL]: {
    /** Staff issue portal credentials for a chart. */
    invite: [RECEPTIONIST],
    viewOwn: EVERY_ROLE,
  },

  [MODULES.FHIR]: {
    read: [DOCTOR, NURSE, LAB_TECH, RADIOLOGIST, PHARMACIST, ACCOUNTANT],
  },

  [MODULES.MATERNITY]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR, NURSE],
  },

  [MODULES.IMMUNIZATIONS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [DOCTOR, NURSE],
  },

  [MODULES.BLOOD_BANK]: {
    view: [DOCTOR, NURSE, LAB_TECH],
    request: [DOCTOR, NURSE],
    crossmatch: [LAB_TECH],
    issue: [LAB_TECH],
    manageUnits: [LAB_TECH],
  },

  [MODULES.PURCHASE]: {
    view: [ACCOUNTANT, PHARMACIST, STAFF],
    create: [ACCOUNTANT, PHARMACIST],
    edit: [ACCOUNTANT, PHARMACIST],
    receive: [ACCOUNTANT, PHARMACIST, STAFF],
    cancel: [ACCOUNTANT],
  },

  [MODULES.SUPPLIERS]: {
    view: [ACCOUNTANT, PHARMACIST, STAFF],
    create: [ACCOUNTANT],
    edit: [ACCOUNTANT],
  },

  [MODULES.FACILITIES]: {
    view: EVERY_ROLE,
    manage: [],
  },

  [MODULES.CDS]: {
    view: [DOCTOR, NURSE, PHARMACIST],
  },

  [MODULES.HIE]: {
    view: [DOCTOR, NURSE],
    export: [DOCTOR],
    consent: [RECEPTIONIST, DOCTOR],
  },

  [MODULES.WAREHOUSE]: {
    view: [ACCOUNTANT],
  },

  [MODULES.DEVICES]: {
    view: [LAB_TECH, RADIOLOGIST, ACCOUNTANT],
    manage: [],
  },
  /* =====================================================================
   * TIER B — CLINICAL SAFETY AND LEGAL RECORDS
   * ===================================================================== */

  /** Code lookup is needed by anyone who records a diagnosis or a problem. */
  [MODULES.TERMINOLOGY]: {
    view: [DOCTOR, NURSE, LAB_TECH, RADIOLOGIST, PHARMACIST, RECEPTIONIST, STAFF],
    import: [],
  },

  /**
   * Critical results. `acknowledge` is wide on purpose — the whole mechanism
   * fails if the one clinician who can close the loop lacks the grant at 2am.
   * `cancel` is narrow: withdrawing an alert must not be an easy way out.
   */
  [MODULES.CRITICAL_ALERTS]: {
    view: [DOCTOR, NURSE, LAB_TECH, RADIOLOGIST, STAFF],
    acknowledge: [DOCTOR, NURSE],
    recordAction: [DOCTOR, NURSE],
    cancel: [],
  },

  /**
   * Controlled drugs. Nobody may edit or delete — the register is append-only
   * at the model, and no permission exists that could override that.
   */
  [MODULES.CONTROLLED_DRUGS]: {
    view: [DOCTOR, NURSE, PHARMACIST],
    record: [NURSE, PHARMACIST],
    witness: [DOCTOR, NURSE, PHARMACIST],
    investigate: [PHARMACIST],
  },

  /**
   * Medico-legal cases are evidence, and access is deliberately narrower than
   * the clinical record: a ward nurse treats the patient but has no business
   * reading the police intimation.
   */
  [MODULES.MEDICO_LEGAL]: {
    view: [DOCTOR],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR],
    informPolice: [DOCTOR],
    issueReport: [],
  },

  [MODULES.DEATH_RECORDS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [DOCTOR],
    /** Certifying cause of death is a doctor's legal act, not clerical. */
    certify: [DOCTOR],
    issueCertificate: [DOCTOR, RECEPTIONIST],
    releaseBody: [DOCTOR, NURSE],
  },

  [MODULES.BIRTH_RECORDS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR, NURSE],
    issueCertificate: [DOCTOR, NURSE, RECEPTIONIST],
  },

  [MODULES.PROBLEMS]: {
    view: [DOCTOR, NURSE, PHARMACIST],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR, NURSE],
    resolve: [DOCTOR],
  },

  [MODULES.CARE_PLANS]: {
    view: [DOCTOR, NURSE],
    create: [DOCTOR, NURSE],
    edit: [DOCTOR, NURSE],
    review: [DOCTOR, NURSE],
  },

  [MODULES.INFECTION_CONTROL]: {
    view: [DOCTOR, NURSE, LAB_TECH, STAFF],
    recordDevice: [DOCTOR, NURSE],
    reportHai: [DOCTOR, NURSE, LAB_TECH],
    order: [DOCTOR],
    report: [DOCTOR, STAFF],
  },

  /**
   * Stewardship: requesting is wide, approving is not. An approval grant held
   * by everyone is the same as no restriction at all.
   */
  [MODULES.ANTIBIOTIC_APPROVALS]: {
    view: [DOCTOR, NURSE, PHARMACIST],
    request: [DOCTOR],
    approve: [PHARMACIST],
  },

  [MODULES.TRANSFUSIONS]: {
    view: [DOCTOR, NURSE, LAB_TECH],
    prepare: [NURSE, LAB_TECH],
    /** Both bedside signatures come through here; the model enforces two people. */
    check: [DOCTOR, NURSE],
    administer: [DOCTOR, NURSE],
    observe: [NURSE],
    reportReaction: [DOCTOR, NURSE],
    investigate: [LAB_TECH, DOCTOR],
  },

  /**
   * Anyone may report an incident — including anonymously. Restricting who can
   * report is the fastest way to stop hearing about anything.
   */
  [MODULES.INCIDENTS]: {
    view: [DOCTOR, NURSE, PHARMACIST, LAB_TECH, RADIOLOGIST, ACCOUNTANT, RECEPTIONIST, STAFF],
    report: [DOCTOR, NURSE, PHARMACIST, LAB_TECH, RADIOLOGIST, ACCOUNTANT, RECEPTIONIST, STAFF],
    investigate: [DOCTOR, STAFF],
    close: [],
    review: [DOCTOR, STAFF],
  },

  [MODULES.COMPLAINTS]: {
    view: [RECEPTIONIST, STAFF, DOCTOR],
    create: [RECEPTIONIST, NURSE, STAFF],
    investigate: [STAFF],
    resolve: [STAFF],
  },

  /* =====================================================================
   * TIER C — OPERATIONAL
   * ===================================================================== */

  /**
   * Referrals. `recordOutcome` is separate because the back-referral often
   * arrives by phone days later and is entered by whoever takes the call.
   */
  [MODULES.REFERRALS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, ACCOUNTANT, STAFF],
    create: [DOCTOR, NURSE, RECEPTIONIST],
    issue: [DOCTOR],
    edit: [DOCTOR, NURSE],
    recordOutcome: [DOCTOR, NURSE, RECEPTIONIST],
    cancel: [DOCTOR],
  },

  /**
   * The OPD queue. Issuing a token is reception work; calling the next patient
   * belongs to whoever is at the counter, which includes the doctor.
   */
  [MODULES.OPD_QUEUE]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, STAFF],
    issue: [RECEPTIONIST, NURSE],
    call: [DOCTOR, NURSE, RECEPTIONIST],
    /** Moving someone into a priority lane must be attributable. */
    prioritise: [RECEPTIONIST, NURSE],
    manageCounter: [RECEPTIONIST],
  },

  [MODULES.AMBULANCE]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, STAFF],
    dispatch: [NURSE, RECEPTIONIST, STAFF],
    updateTrip: [NURSE, RECEPTIONIST, STAFF],
    manageFleet: [],
  },

  [MODULES.DIALYSIS]: {
    view: [DOCTOR, NURSE],
    schedule: [NURSE, RECEPTIONIST],
    /** Running a session is nursing work under a doctor's prescription. */
    recordSession: [NURSE, DOCTOR],
    manageMachines: [],
  },

  /**
   * Medical records. `release` is held tight and separately from `view`:
   * handing a chart to an insurer is a confidentiality decision, not a
   * clerical one, and the model already refuses it without consent or a legal
   * basis.
   */
  [MODULES.MEDICAL_RECORDS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, STAFF],
    trackFile: [RECEPTIONIST, STAFF],
    code: [STAFF],
    requestRelease: [RECEPTIONIST, STAFF],
    approveRelease: [],
    release: [STAFF],
  },

  [MODULES.DIETARY]: {
    view: [DOCTOR, NURSE, STAFF],
    /** A diet order is a clinical instruction, so clinicians write it. */
    order: [DOCTOR, NURSE],
    kitchenReport: [NURSE, STAFF],
  },

  [MODULES.HOUSEKEEPING]: {
    view: [NURSE, STAFF],
    raise: [NURSE, RECEPTIONIST, STAFF],
    complete: [STAFF],
    /** A nurse confirms the bed is fit to use — cleaning is not self-certified. */
    verify: [NURSE],
  },

  [MODULES.WASTE]: {
    view: [NURSE, STAFF],
    record: [NURSE, STAFF],
    dispose: [STAFF],
  },

  [MODULES.CSSD]: {
    view: [NURSE, DOCTOR, STAFF],
    runCycle: [NURSE, STAFF],
    /** Reading the biological indicator releases or quarantines a whole load. */
    releaseLoad: [NURSE, STAFF],
    manageSets: [STAFF],
  },

  [MODULES.ASSETS]: {
    view: [DOCTOR, NURSE, LAB_TECH, RADIOLOGIST, ACCOUNTANT, STAFF],
    /** Anyone who finds a broken machine must be able to report it. */
    reportFault: [DOCTOR, NURSE, LAB_TECH, RADIOLOGIST, PHARMACIST, STAFF],
    maintain: [STAFF],
    manage: [],
  },

  [MODULES.THERAPY]: {
    view: [DOCTOR, NURSE, STAFF],
    refer: [DOCTOR],
    recordSession: [STAFF, NURSE],
    discharge: [STAFF, DOCTOR],
  },

  /**
   * Mortuary. `release` requires a witness at the model; the permission is
   * narrow as well, because releasing a body to the wrong family is
   * unrecoverable.
   */
  [MODULES.MORTUARY]: {
    view: [DOCTOR, NURSE, STAFF],
    receive: [NURSE, STAFF],
    release: [DOCTOR, STAFF],
    witnessRelease: [DOCTOR, NURSE, STAFF],
  },

  [MODULES.TELEMEDICINE]: {
    view: [DOCTOR, NURSE, RECEPTIONIST],
    schedule: [RECEPTIONIST, NURSE],
    consult: [DOCTOR],
  },



  /* =====================================================================
   * TIER A — NEPAL LOCALISATION
   * ===================================================================== */

  /**
   * Provinces, districts, local levels, BS↔AD conversion, fiscal years.
   * Public administrative geography — every signed-in user needs it to render
   * an address or a date, and there is nothing here worth restricting.
   * `import` is separate because it rewrites the table the whole system keys on.
   */
  [MODULES.NEPAL_REFERENCE]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, LAB_TECH, RADIOLOGIST, PHARMACIST, ACCOUNTANT, STAFF],
    import: [],
  },

  /**
   * Scheme *definitions* — ceilings, eligibility rules, claim routes.
   *
   * Reading is wide because the counter must be able to explain to a patient
   * why they do or do not qualify. Writing is admin-only: these figures decide
   * who gets free care and how much the hospital can reclaim, so changing one
   * is a policy act, not data entry.
   */
  [MODULES.SCHEMES]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, ACCOUNTANT, STAFF],
    create: [],
    edit: [],
    delete: [],
  },

  /**
   * A patient's claim on a scheme.
   *
   * `verify` is deliberately separated from `create`: recording that a card
   * exists is ordinary reception work, but *sighting* it is the act that lets
   * free care be applied, and applying free care on an unverified entitlement
   * is the finding every scheme audit looks for. Reception can register;
   * confirming it is a narrower grant.
   */
  [MODULES.ENTITLEMENTS]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, ACCOUNTANT, STAFF],
    create: [RECEPTIONIST, ACCOUNTANT],
    edit: [RECEPTIONIST, ACCOUNTANT],
    verify: [ACCOUNTANT],
    revoke: [ACCOUNTANT],
  },

  /** Reimbursement claims against government programmes. */
  [MODULES.SCHEME_CLAIMS]: {
    view: [ACCOUNTANT, RECEPTIONIST, STAFF],
    create: [ACCOUNTANT],
    submit: [ACCOUNTANT],
    recordDecision: [ACCOUNTANT],
    writeOff: [],
  },

  /**
   * Health Insurance Board households.
   *
   * `checkEligibility` is granted widely and on purpose — the answer is needed
   * at the counter, at triage and on the ward before treatment, not only in
   * accounts. Editing the household (its ceiling, its members) is far narrower.
   */
  [MODULES.HIB]: {
    view: [DOCTOR, NURSE, RECEPTIONIST, ACCOUNTANT, STAFF],
    checkEligibility: [DOCTOR, NURSE, RECEPTIONIST, ACCOUNTANT, STAFF],
    create: [RECEPTIONIST, ACCOUNTANT],
    edit: [ACCOUNTANT],
    verify: [RECEPTIONIST, ACCOUNTANT],
  },

  /**
   * Credit notes — the only lawful way to reverse an issued invoice.
   *
   * `approve` is admin-only and separate from `create`, mirroring the discount
   * workflow: one person asks for money to come off a tax document, a different
   * person authorises it.
   */
  [MODULES.CREDIT_NOTES]: {
    view: [ACCOUNTANT, RECEPTIONIST],
    create: [ACCOUNTANT],
    approve: [],
  },

  /**
   * Collections through eSewa / Khalti / Fonepay / ConnectIPS.
   * `reconcile` is the settlement-file match, which is an accounts function.
   */
  [MODULES.GATEWAY_PAYMENTS]: {
    view: [ACCOUNTANT, RECEPTIONIST],
    initiate: [ACCOUNTANT, RECEPTIONIST],
    verify: [ACCOUNTANT, RECEPTIONIST],
    reconcile: [ACCOUNTANT],
    refund: [],
  },

  /** Outbound SMS: the log, the spend, and manual resend. */
  [MODULES.SMS]: {
    view: [RECEPTIONIST, ACCOUNTANT, STAFF],
    send: [RECEPTIONIST, NURSE],
    resend: [RECEPTIONIST, ACCOUNTANT],
  },

  /**
   * Statutory HMIS / DHIS2 returns.
   *
   * `approve` is the sign-off that sends a figure to the Ministry over a named
   * person's authority — MoHP comes back to *that person* about it, so it is
   * held tighter than generating a draft.
   */
  [MODULES.HMIS]: {
    view: [ACCOUNTANT, STAFF, DOCTOR],
    generate: [STAFF, ACCOUNTANT],
    review: [STAFF, ACCOUNTANT],
    approve: [],
    submit: [],
  },
});

// ---------------------------------------------------------------------------
// Lookup API
// ---------------------------------------------------------------------------

/** All action names defined for a module. */
export function actionsFor(module) {
  return Object.keys(PERMISSION_MATRIX[module] ?? {});
}

/**
 * Throws if (module, action) is not in the matrix.
 *
 * Called by `requirePermission()` at *route-definition* time, not per request,
 * so a typo like `requirePermission('patient', 'view')` crashes the server at
 * boot instead of silently allowing or denying traffic in production.
 */
export function assertPermissionExists(module, action) {
  const moduleEntry = PERMISSION_MATRIX[module];
  if (!moduleEntry) {
    throw new Error(
      `Unknown permission module "${module}". Add it to MODULES and PERMISSION_MATRIX in config/permissions.js.`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(moduleEntry, action)) {
    throw new Error(
      `Unknown action "${action}" for module "${module}". Known actions: ${actionsFor(module).join(', ')}.`,
    );
  }
}

/** Does `role` hold `action` on `module`? The one authorization question. */
export function can(role, module, action) {
  if (!role) return false;
  if (ADMIN_HAS_FULL_ACCESS && role === ROLES.ADMIN) {
    // Still validated, so an admin request cannot mask a wiring typo.
    assertPermissionExists(module, action);
    return true;
  }

  const allowed = PERMISSION_MATRIX[module]?.[action];
  if (!allowed) return false;
  return allowed.includes(role);
}

/**
 * The full grant for one role, as `{ module: [actions] }`.
 *
 * Sent to the client on sign-in so the UI can hide what the user cannot do,
 * without the client keeping its own copy of the rules. Modules where the role
 * holds nothing are omitted.
 */
export function permissionsForRole(role) {
  const result = {};
  for (const module of Object.keys(PERMISSION_MATRIX)) {
    const granted = actionsFor(module).filter((action) => can(role, module, action));
    if (granted.length > 0) result[module] = granted;
  }
  return result;
}

/** Every role that holds `action` on `module`, admin included. Used by docs/tests. */
export function rolesWith(module, action) {
  assertPermissionExists(module, action);
  return ROLE_VALUES.filter((role) => can(role, module, action));
}

export default PERMISSION_MATRIX;
