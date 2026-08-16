import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { MODULES } from '../config/permissions.js';
import { deepHealth } from '../middleware/observability.js';
import { snapshotMetrics } from '../utils/logger.js';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import patientRoutes from './patientRoutes.js';
import departmentRoutes from './departmentRoutes.js';
import wardRoutes from './wardRoutes.js';
import encounterRoutes from './encounterRoutes.js';
import appointmentRoutes from './appointmentRoutes.js';
import clinicalNoteRoutes from './clinicalNoteRoutes.js';
import admissionRoutes from './admissionRoutes.js';
import labTestRoutes from './labTestRoutes.js';
import labOrderRoutes from './labOrderRoutes.js';
import labResultRoutes from './labResultRoutes.js';
import radiologyExamRoutes from './radiologyExamRoutes.js';
import radiologyOrderRoutes from './radiologyOrderRoutes.js';
import radiologyResultRoutes from './radiologyResultRoutes.js';
import pharmacyRoutes from './pharmacyRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import insuranceRoutes from './insuranceRoutes.js';
import billingRoutes from './billingRoutes.js';
import invoiceRoutes from './invoiceRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import attendanceRoutes from './attendanceRoutes.js';
import payrollRoutes from './payrollRoutes.js';
import reportRoutes from './reportRoutes.js';
import auditLogRoutes from './auditLogRoutes.js';
import emarRoutes from './emarRoutes.js';
import theatreRoutes from './theatreRoutes.js';
import triageRoutes from './triageRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import packageRoutes from './packageRoutes.js';
import hl7Routes from './hl7Routes.js';
import dicomRoutes from './dicomRoutes.js';
import portalRoutes from './portalRoutes.js';
import maternityRoutes from './maternityRoutes.js';
import bloodBankRoutes from './bloodBankRoutes.js';
import purchaseRoutes from './purchaseRoutes.js';
import {
  facilityRouter,
  fhirRouter,
  cdsRouter,
  hieRouter,
  remittanceRouter,
  deviceRouter,
  warehouseRouter,
} from './tier23Routes.js';

// Tier B - clinical safety and legal records; Tier C - referrals
import {
  terminologyRouter,
  criticalRouter,
  controlledDrugRouter,
  mlcRouter,
  deathRouter,
  birthRouter,
  problemRouter,
  carePlanRouter,
  infectionRouter,
  stewardshipRouter,
  transfusionRouter,
  incidentRouter,
  complaintRouter,
  referralRouter,
} from './clinicalRoutes.js';

// Tier C - operational modules
import {
  queueRouter,
  ambulanceRouter,
  dialysisRouter,
  recordsRouter,
  dietRouter,
  housekeepingRouter,
  wasteRouter,
  cssdRouter,
  assetRouter,
  therapyRouter,
  mortuaryRouter,
  teleRouter,
} from './operationsRoutes.js';

// Tier A — Nepal localisation
import nepalRoutes from './nepalRoutes.js';
import schemeRoutes, { entitlementRouter, schemeClaimRouter } from './schemeRoutes.js';
import hibRoutes from './hibRoutes.js';
import { creditNoteRouter, gatewayRouter, gatewayWebhookRouter } from './nepalBillingRoutes.js';
import smsRoutes from './smsRoutes.js';
import hmisRoutes from './hmisRoutes.js';

const router = Router();

/**
 * Liveness: is the process up? Cheap and unconditional, for a container probe.
 */
router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

/**
 * Readiness: is it actually able to serve? Checks the database, transaction
 * support and the Devanagari font, and answers 503 when it cannot — so a load
 * balancer stops routing to a container that has lost its database instead of
 * cheerfully forwarding traffic into failures.
 */
router.get('/health/ready', deepHealth);

/** Request timings, slow routes and error counts, for the admin screen. */
router.get('/metrics', requireAuth, requirePermission(MODULES.REPORTS, 'viewOperational'), (_req, res) => {
  res.json({ success: true, data: snapshotMetrics() });
});

// Phase 0
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/audit-logs', auditLogRoutes);

// Phase 1
router.use('/patients', patientRoutes);
router.use('/departments', departmentRoutes);
router.use('/wards', wardRoutes);
router.use('/encounters', encounterRoutes);

// Phase 2 — Appointment scheduling
router.use('/appointments', appointmentRoutes);

// Phase 3 — EHR. Vitals and the patient timeline nest under /encounters and
// /patients, since they are scoped to those resources.
router.use('/clinical-notes', clinicalNoteRoutes);

// Phase 4 — OPD/IPD workflow. The bed board and the admitted-patient list; the
// actions that change an admission live on /encounters/:id.
router.use('/admissions', admissionRoutes);

// Phase 6 — Laboratory
router.use('/lab/tests', labTestRoutes);
router.use('/lab/orders', labOrderRoutes);
router.use('/lab/results', labResultRoutes);

// Phase 7 — Radiology
router.use('/radiology/exams', radiologyExamRoutes);
router.use('/radiology/orders', radiologyOrderRoutes);
router.use('/radiology/results', radiologyResultRoutes);

// Phase 8 — Pharmacy: formulary, stock batches, prescribing and dispensing
router.use('/pharmacy', pharmacyRoutes);

// Phase 9 — General (non-drug) inventory: catalogue, stock ledger, consumption
router.use('/inventory', inventoryRoutes);

// Phase 11 — Insurance: insurers, policies, pre-authorisations, claims
router.use('/insurance', insuranceRoutes);

// Phase 10 — Billing: the shared charge ledger, invoices and payments
router.use('/billing', billingRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);

// Phase 12 — Staff attendance and payroll. Attendance is mounted separately
// because it is a staff record in its own right, not a payroll sub-resource.
router.use('/attendance', attendanceRoutes);
router.use('/payroll', payrollRoutes);

// Phase 13 — Management reporting and the dashboard. Read-only aggregations
// over what the other phases wrote; nothing here has a write path.
router.use('/reports', reportRoutes);

// Tier 1 — ward-hard clinical, imaging store, notifications, packages
router.use('/emar', emarRoutes);
router.use('/theatre', theatreRoutes);
router.use('/triage', triageRoutes);
router.use('/notifications', notificationRoutes);
router.use('/billing/packages', packageRoutes);
router.use('/lab/inbound', hl7Routes);
router.use('/dicom', dicomRoutes);

// Tier 2 / 3
router.use('/portal', portalRoutes);
router.use('/maternity', maternityRoutes);
router.use('/blood-bank', bloodBankRoutes);
router.use('/purchase', purchaseRoutes);
router.use('/facilities', facilityRouter);
router.use('/fhir', fhirRouter);
router.use('/cds-services', cdsRouter);
router.use('/hie', hieRouter);
router.use('/remittances', remittanceRouter);
router.use('/devices', deviceRouter);
router.use('/reports/warehouse', warehouseRouter);

/* ==========================================================================
 * TIER A — NEPAL LOCALISATION
 * ==========================================================================
 * Mounted last so the ordering above is untouched, but these are not an
 * afterthought: without them a Nepali hospital cannot legally bill, report or
 * insure a patient.
 */

// A1/A3/A4 — administrative geography, identity documents, BS↔AD conversion.
router.use('/nepal', nepalRoutes);

// A7 — government free-care schemes. Entitlements and claims sit on their own
// paths: a patient's entitlement belongs to the patient as much as the scheme.
router.use('/schemes', schemeRoutes);
router.use('/entitlements', entitlementRouter);
router.use('/scheme-claims', schemeClaimRouter);

// A6 — Health Insurance Board household policies, shared ceilings, referrals.
router.use('/hib', hibRoutes);

// A8 — credit notes. There is no route to void an issued invoice, by design.
router.use('/credit-notes', creditNoteRouter);

// A10 — eSewa / Khalti / Fonepay / ConnectIPS.
//
// The webhook is mounted at its OWN top-level path, not under /payments: that
// mount applies requireAuth to everything beneath it, and a payment gateway has
// no session. Nested, the callback would be rejected with 401 and the hospital
// would silently stop learning about completed payments — money arrives and no
// invoice is ever marked paid.
router.use('/webhooks/payment', gatewayWebhookRouter);
router.use('/payments/gateway', gatewayRouter);

// A11 — outbound SMS: the log, the spend, manual send and resend.
router.use('/sms', smsRoutes);

// A9 — statutory HMIS / DHIS2 returns.
router.use('/hmis/returns', hmisRoutes);

/* ==========================================================================
 * TIER B — CLINICAL SAFETY AND LEGAL RECORDS
 * ======================================================================= */

// B1 — ICD / LOINC / SNOMED lookup and validation.
router.use('/terminology', terminologyRouter);

// B4 — the critical-result acknowledgement board and escalation loop.
router.use('/critical-alerts', criticalRouter);

// B5 — narcotic register. No update or delete route exists, by design.
router.use('/controlled-drugs', controlledDrugRouter);

// B6 — medico-legal cases. Reads are audited; this is evidence.
router.use('/medico-legal', mlcRouter);

// B7 — death (with MCCD certification) and birth records.
router.use('/death-records', deathRouter);
router.use('/birth-records', birthRouter);

// B8 — the longitudinal problem list and care plans.
router.use('/problems', problemRouter);
router.use('/care-plans', carePlanRouter);

// B9 — HAI surveillance, isolation, and antimicrobial stewardship.
router.use('/infection-control', infectionRouter);
router.use('/stewardship', stewardshipRouter);

// B10 — transfusion administration and haemovigilance.
router.use('/transfusions', transfusionRouter);

// B11 — incidents, complaints, and the governance reports over them.
router.use('/incidents', incidentRouter);
router.use('/complaints', complaintRouter);

/* ==========================================================================
 * TIER C — OPERATIONAL
 * ======================================================================= */

// C1 — referral in and out, including the back-referral loop.
router.use('/referrals', referralRouter);

// C2 - OPD queue. `/queue/board` is unauthenticated by design: it runs on a
// waiting-hall television and returns token numbers only, never a patient name.
router.use('/queue', queueRouter);

// C3 - ambulance fleet and dispatch.
router.use('/ambulance', ambulanceRouter);

// C4 - dialysis machines and sessions.
router.use('/dialysis', dialysisRouter);

// C5 - medical records: file custody, release of information, coding worklist.
router.use('/medical-records', recordsRouter);

// C6 + C9 - dietary, housekeeping, healthcare waste.
router.use('/dietary', dietRouter);
router.use('/housekeeping', housekeepingRouter);
router.use('/waste', wasteRouter);

// C7 + C8 - sterilisation traceability and the biomedical asset register.
router.use('/cssd', cssdRouter);
router.use('/assets', assetRouter);

// C10 + C11 + C12 - therapy, mortuary, telemedicine.
router.use('/therapy', therapyRouter);
router.use('/mortuary', mortuaryRouter);
router.use('/telemedicine', teleRouter);

export default router;
