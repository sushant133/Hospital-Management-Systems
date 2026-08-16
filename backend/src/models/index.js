export { default as Counter } from './Counter.js';
export { default as User } from './User.js';
export { default as AuditLog, AUDIT_ACTIONS, AUDIT_OUTCOMES } from './AuditLog.js';
export { default as Patient } from './Patient.js';
export { default as Department } from './Department.js';
export { default as Ward, WARD_TYPES } from './Ward.js';
export { default as Bed, BED_STATUSES } from './Bed.js';
export {
  default as Encounter,
  ENCOUNTER_TYPES,
  ENCOUNTER_STATUSES,
} from './Encounter.js';

// Phase 4 — Admissions & bed allocation
export {
  default as NursingRound,
  MOBILITY_LEVELS,
  CONSCIOUSNESS_LEVELS,
  RISK_LEVELS,
} from './NursingRound.js';

// Phase 3 — EHR: append-only notes and the vitals series
export { default as ClinicalNote, NOTE_TYPES, SOAP_FIELDS } from './ClinicalNote.js';
export { default as VitalSigns, VITAL_FLAGS, MEASUREMENTS } from './VitalSigns.js';

// Phase 2 — Appointment scheduling
export {
  default as Appointment,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  APPOINTMENT_TRANSITIONS,
  ACTIVE_APPOINTMENT_STATUSES,
} from './Appointment.js';
export {
  default as DoctorAvailability,
  DAYS_OF_WEEK,
  DAY_LABELS,
  TIME_PATTERN,
  toMinutes,
  toTimeString,
} from './DoctorAvailability.js';

// Phase 4 — Laboratory
export { default as LabTest, SPECIMEN_TYPES, ANALYTE_VALUE_TYPES } from './LabTest.js';
export {
  default as LabOrder,
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  LAB_STATUS_TRANSITIONS,
} from './LabOrder.js';
export { default as LabResult, RESULT_FLAGS, RESULT_STATUSES } from './LabResult.js';

// Phase 7 — Radiology
export {
  default as RadiologyExam,
  MODALITIES,
  MODALITY_LABELS,
} from './RadiologyExam.js';
export {
  default as RadiologyOrder,
  RADIOLOGY_ORDER_STATUSES,
  RADIOLOGY_PRIORITIES,
  RADIOLOGY_STATUS_TRANSITIONS,
} from './RadiologyOrder.js';
export {
  default as RadiologyResult,
  RADIOLOGY_RESULT_STATUSES,
} from './RadiologyResult.js';

// Phase 8 — Pharmacy
export { default as Drug, DRUG_FORMS, DRUG_ROUTES } from './Drug.js';
export { default as DrugBatch, BATCH_STATUSES } from './DrugBatch.js';
export { default as Prescription, PRESCRIPTION_STATUSES } from './Prescription.js';
export { default as Dispense } from './Dispense.js';

// Phase 12 — Attendance & payroll
export {
  default as Attendance,
  ATTENDANCE_STATUSES,
  SHIFTS,
  PAYABLE_FRACTION,
  STANDARD_SHIFT_HOURS,
} from './Attendance.js';
export { default as ShiftRoster, ROSTER_STATUSES } from './ShiftRoster.js';
export { default as ShiftAssignment } from './ShiftAssignment.js';
export { default as SalaryStructure } from './SalaryStructure.js';
export {
  default as PayrollRun,
  PAYROLL_STATUSES,
  PAYROLL_TRANSITIONS,
} from './PayrollRun.js';
export { default as Payslip } from './Payslip.js';

// Phase 10 — Billing: invoices and payments
export {
  default as Invoice,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  DISCOUNT_STATUSES,
} from './Invoice.js';
export { default as Payment, PAYMENT_TYPES, PAYMENT_METHODS } from './Payment.js';

// Phase 11 — Insurance
export { default as InsuranceProvider } from './InsuranceProvider.js';
export { default as PatientPolicy, POLICY_STATUSES, RELATIONSHIPS } from './PatientPolicy.js';
export {
  default as PreAuthorization,
  PREAUTH_STATUSES,
  PREAUTH_TRANSITIONS,
} from './PreAuthorization.js';
export { default as Claim, CLAIM_STATUSES, CLAIM_TRANSITIONS } from './Claim.js';

// Phase 9 — General (non-drug) inventory
export { default as InventoryItem, INVENTORY_CATEGORIES } from './InventoryItem.js';
export {
  default as InventoryTransaction,
  TRANSACTION_TYPES,
  TRANSACTION_DIRECTION,
} from './InventoryTransaction.js';

export {
  default as MedicationAdministration,
  MAR_STATUSES,
} from './MedicationAdministration.js';
export {
  default as Surgery,
  SURGERY_STATUSES,
  SURGERY_TRANSITIONS,
  THEATRE_ROOMS,
} from './Surgery.js';
export { default as Triage, ESI_LEVELS, TRIAGE_STATUSES } from './Triage.js';
export { default as Notification, NOTIFICATION_TYPES } from './Notification.js';
export { default as BillingPackage } from './BillingPackage.js';
export { default as DicomStudy } from './DicomStudy.js';

export { default as Facility } from './Facility.js';
export { default as PatientPortalAccount } from './PatientPortalAccount.js';
export { default as MaternityCase, MATERNITY_STATUSES } from './MaternityCase.js';
export { default as AncVisit } from './AncVisit.js';
export { default as Immunization } from './Immunization.js';
export { default as BloodUnit, BLOOD_COMPONENTS, UNIT_STATUSES } from './BloodUnit.js';
export { default as BloodRequest, BLOOD_REQUEST_STATUSES } from './BloodRequest.js';
export { default as DrugInteraction, INTERACTION_SEVERITIES } from './DrugInteraction.js';
export { default as Supplier } from './Supplier.js';
export { default as PurchaseOrder, PO_STATUSES, PO_TRANSITIONS } from './PurchaseOrder.js';
export { default as Consent, CONSENT_PURPOSES, CONSENT_STATUSES } from './Consent.js';
export { default as Remittance } from './Remittance.js';
export { default as Device, DEVICE_KINDS } from './Device.js';
export { default as DailySnapshot } from './DailySnapshot.js';

/* ==========================================================================
 * CLINICAL TERMINOLOGY (Tier B — B1/B2)
 * ======================================================================= */

// ICD, LOINC, SNOMED CT in one collection; `codeableConcept` is the embedded
// shape every coded field on a clinical record uses.
export {
  default as CodeSystem,
  CODE_SYSTEMS,
  CODE_SYSTEM_VALUES,
  CODE_SYSTEM_LABELS,
  codeableConcept,
} from './CodeSystem.js';

/* ==========================================================================
 * PLATFORM (Tier D)
 * ======================================================================= */

// D8 — custom roles composed from the same permission matrix, with scope.
export { default as CustomRole } from './CustomRole.js';

// D3 — active sessions, so a user can see and revoke individual logins.
export { default as Session } from './Session.js';

// D1 — idempotency keys, so a retried payment or dispense cannot double-post.
export { default as IdempotencyKey } from './IdempotencyKey.js';

/* ==========================================================================
 * CLINICAL SAFETY AND LEGAL RECORDS (Tier B)
 * ======================================================================= */

// B4 — the critical-result acknowledgement and escalation loop.
export {
  default as CriticalAlert,
  ALERT_SOURCES,
  ALERT_STATUSES,
  ESCALATION_LEVELS,
} from './CriticalAlert.js';

// B5 — narcotic/psychotropic register: append-only, witnessed, running balance.
export {
  default as ControlledDrugRegister,
  DRUG_SCHEDULES,
  REGISTER_ENTRY_TYPES,
} from './ControlledDrugRegister.js';

// B6 — medico-legal cases. Evidence, with narrower access than the chart.
export {
  default as MedicoLegalCase,
  MLC_CATEGORIES,
  MLC_STATUSES,
} from './MedicoLegalCase.js';

// B7 — death (with MCCD) and birth records.
export {
  DeathRecord,
  BirthRecord,
  DEATH_MANNERS,
  DEATH_PLACES,
  DELIVERY_TYPES,
  BIRTH_OUTCOMES,
} from './VitalRecords.js';

// B8 — longitudinal problem list, care plans, note templates.
export {
  Problem,
  CarePlan,
  NoteTemplate,
  PROBLEM_STATUSES,
  PROBLEM_SEVERITIES,
  CARE_PLAN_STATUSES,
  GOAL_STATUSES,
} from './Problem.js';

// B9 — HAI surveillance with device-day denominators, isolation, stewardship.
export {
  DeviceDay,
  HaiCase,
  IsolationOrder,
  AntibioticApproval,
  HAI_TYPES,
  HAI_TYPE_VALUES,
  DEVICE_TYPES,
  ISOLATION_TYPES,
  ANTIBIOTIC_TIERS,
  APPROVAL_STATUSES,
} from './InfectionControl.js';

// B10 — transfusion administration and haemovigilance.
export {
  Transfusion,
  TransfusionReaction,
  TRANSFUSION_STATUSES,
  REACTION_TYPES,
  REACTION_SEVERITIES,
} from './Transfusion.js';

// B11 — incidents, mortality review, complaints.
export {
  IncidentReport,
  MortalityReview,
  Complaint,
  INCIDENT_CATEGORIES,
  HARM_LEVELS,
  INCIDENT_STATUSES,
  MM_VERDICTS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
} from './ClinicalGovernance.js';

/* ==========================================================================
 * OPERATIONAL MODULES (Tier C)
 * ======================================================================= */

// C1 — referral in and out, including the back-referral loop that paper
// systems lose. HIB reimbursement depends on the referral chain being provable.
export {
  default as Referral,
  REFERRAL_DIRECTIONS,
  REFERRAL_STATUSES,
  REFERRAL_TRANSITIONS,
  REFERRAL_URGENCY,
  REFERRAL_REASONS,
} from './Referral.js';

// C2 — OPD queue and the waiting-hall display board.
export { OpdToken, QueueCounter, TOKEN_STATUSES, QUEUE_PRIORITIES } from './OpdQueue.js';

// C3 — ambulance fleet and dispatch.
export {
  Ambulance,
  AmbulanceTrip,
  VEHICLE_TYPES,
  VEHICLE_STATUSES,
  TRIP_TYPES,
  TRIP_STATUSES,
} from './Ambulance.js';

// C4 — dialysis: machines and the per-session clinical record.
export {
  DialysisMachine,
  DialysisSession,
  MACHINE_STATUSES,
  VASCULAR_ACCESS,
  SESSION_STATUSES,
} from './Dialysis.js';

// C5 — medical records: file custody, release of information, coding worklist.
export {
  PatientFile,
  RecordRelease,
  CodingTask,
  FILE_LOCATIONS,
  RELEASE_REQUESTERS,
  RELEASE_STATUSES,
  CODING_STATUSES,
} from './MedicalRecords.js';

// C6 + C9 — dietary, housekeeping, healthcare waste, linen.
export {
  DietOrder,
  HousekeepingTask,
  WasteLog,
  LinenTransaction,
  DIET_TYPES,
  MEAL_TIMES,
  TASK_TYPES,
  TASK_STATUSES,
  WASTE_CATEGORIES,
  WASTE_CATEGORY_VALUES,
  DISPOSAL_METHODS,
} from './SupportServices.js';

// C7 + C8 — CSSD sterilisation traceability and the biomedical asset register.
export {
  SterilisationCycle,
  InstrumentSet,
  Asset,
  MaintenanceTask,
  SET_STATUSES,
  CYCLE_TYPES,
  INDICATOR_RESULTS,
  ASSET_STATUSES,
  MAINTENANCE_TYPES,
} from './AssetsAndSterilisation.js';

// C10 + C11 + C12 — therapy courses, mortuary, telemedicine.
export {
  TherapyCourse,
  TherapySession,
  MortuaryRecord,
  Teleconsultation,
  THERAPY_DISCIPLINES,
  THERAPY_SESSION_STATUSES,
  BODY_STATUSES,
  TELE_MODALITIES,
  TELE_STATUSES,
} from './TherapyAndRemote.js';

/* ==========================================================================
 * NEPAL LOCALISATION (Tier A)
 * ======================================================================= */

// A8 — IRD: an issued invoice is reversed by a credit note, never voided.
export { default as CreditNote, CREDIT_NOTE_REASONS } from './CreditNote.js';

// A7 — government free-care and subsidy schemes.
export {
  default as Scheme,
  COVERAGE_MODES,
  COVERAGE_MODE_VALUES,
  CEILING_PERIODS,
  CLAIM_ROUTES,
} from './Scheme.js';
export {
  default as PatientEntitlement,
  ENTITLEMENT_STATUSES,
} from './PatientEntitlement.js';
export {
  default as SchemeClaim,
  SCHEME_CLAIM_STATUSES,
  SCHEME_CLAIM_TRANSITIONS,
} from './SchemeClaim.js';

// A6 — Health Insurance Board household policies.
export {
  default as HibHousehold,
  HIB_MEMBER_RELATIONSHIPS,
  HIB_HOUSEHOLD_STATUSES,
} from './HibHousehold.js';

// A11 — outbound SMS, queued and retried.
export { default as SmsMessage, SMS_STATUSES, SMS_TEMPLATES } from './SmsMessage.js';

// A10 — domestic payment gateway transactions.
export {
  default as GatewayTransaction,
  GATEWAY_PROVIDERS,
  GATEWAY_TXN_STATUSES,
} from './GatewayTransaction.js';

// A9 — statutory HMIS / DHIS2 returns.
export { default as HmisReturn, HMIS_RETURN_STATUSES } from './HmisReturn.js';

// Shared billing ledger — written by lab/radiology/pharmacy, consumed by Phase 10.
export {
  default as BillingLineItem,
  CHARGE_SOURCE_TYPES,
  LINE_ITEM_STATUSES,
} from './BillingLineItem.js';
