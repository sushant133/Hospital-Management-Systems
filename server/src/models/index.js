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

// Phase 4 — Laboratory
export { default as LabTest, SPECIMEN_TYPES, ANALYTE_VALUE_TYPES } from './LabTest.js';
export {
  default as LabOrder,
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  LAB_STATUS_TRANSITIONS,
} from './LabOrder.js';
export { default as LabResult, RESULT_FLAGS, RESULT_STATUSES } from './LabResult.js';

// Shared billing ledger — written by lab/radiology/pharmacy, consumed by Phase 8.
export {
  default as BillingLineItem,
  CHARGE_SOURCE_TYPES,
  LINE_ITEM_STATUSES,
} from './BillingLineItem.js';
