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
 * - Module-specific verbs (`verify`, `dispense`, `approveDiscount`, …) exist
 *   where a workflow step needs a narrower gate than plain `edit`.
 * - Modules for phases that are not built yet are already listed, so that later
 *   phases wire routes to an existing entry instead of inventing new rules.
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
    edit: [RECEPTIONIST, DOCTOR, NURSE],
    delete: [RECEPTIONIST],
    /** Turning a booking into a live encounter at the front desk. */
    checkIn: [RECEPTIONIST, NURSE],
    cancel: [RECEPTIONIST, DOCTOR, NURSE],
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
    void: [ACCOUNTANT],
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
  // PAYROLL — access-separated from patient billing (see ARCHITECTURE.md §4)
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
