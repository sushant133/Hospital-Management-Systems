/**
 * Client-side permission helpers.
 *
 * There is deliberately NO copy of the permission matrix here. The server sends
 * the signed-in user's effective permissions with `/auth/me`, `/auth/login` and
 * `/auth/refresh`, shaped as:
 *
 *   { patients: ['view', 'create', 'edit'], wards: ['view'], … }
 *
 * Keeping a second matrix in the browser guarantees the two drift apart, and
 * the drift is invisible until someone sees a button they cannot actually use.
 * The module names below are just string constants for autocomplete — the
 * grants themselves always come from the server.
 *
 * These checks are UX only. The API re-checks every request.
 */

export const MODULES = Object.freeze({
  PATIENTS: 'patients',
  DEPARTMENTS: 'departments',
  WARDS: 'wards',
  BEDS: 'beds',
  APPOINTMENTS: 'appointments',
  ENCOUNTERS: 'encounters',
  CLINICAL_NOTES: 'clinicalNotes',
  STAFF: 'staff',
  ATTENDANCE: 'attendance',
  LAB_TESTS: 'labTests',
  LAB_ORDERS: 'labOrders',
  LAB_RESULTS: 'labResults',
  RADIOLOGY_EXAMS: 'radiologyExams',
  RADIOLOGY_ORDERS: 'radiologyOrders',
  RADIOLOGY_RESULTS: 'radiologyResults',
  PRESCRIPTIONS: 'prescriptions',
  DRUGS: 'drugs',
  DRUG_BATCHES: 'drugBatches',
  DISPENSING: 'dispensing',
  INVENTORY: 'inventory',
  BILLING: 'billing',
  INVOICES: 'invoices',
  PAYMENTS: 'payments',
  INSURANCE_PROVIDERS: 'insuranceProviders',
  PATIENT_POLICIES: 'patientPolicies',
  PRE_AUTHORIZATIONS: 'preAuthorizations',
  CLAIMS: 'claims',
  PAYROLL: 'payroll',
  REPORTS: 'reports',
  AUDIT_LOGS: 'auditLogs',
  MEDICATION_ADMIN: 'medicationAdmin',
  THEATRE: 'theatre',
  TRIAGE: 'triage',
  NOTIFICATIONS: 'notifications',
  BILLING_PACKAGES: 'billingPackages',
  DICOM: 'dicom',
  PORTAL: 'portal',
  FHIR: 'fhir',
  MATERNITY: 'maternity',
  IMMUNIZATIONS: 'immunizations',
  BLOOD_BANK: 'bloodBank',
  PURCHASE: 'purchase',
  SUPPLIERS: 'suppliers',
  FACILITIES: 'facilities',
  CDS: 'cds',
  HIE: 'hie',
  WAREHOUSE: 'warehouse',
  DEVICES: 'devices',
});

/** Does this permission map grant `action` on `module`? */
export function hasPermission(permissions, module, action) {
  if (!permissions || !module || !action) return false;
  return Boolean(permissions[module]?.includes(action));
}

/** Any one of several actions on the same module — "can they do anything here?" */
export function hasAnyPermission(permissions, module, actions = []) {
  return actions.some((action) => hasPermission(permissions, module, action));
}

/** Does the user hold at least one permission in `module`? Used for nav filtering. */
export function canAccessModule(permissions, module) {
  return Boolean(permissions?.[module]?.length);
}
