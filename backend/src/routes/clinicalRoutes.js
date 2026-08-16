import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import auditRead from '../middleware/auditRead.js';
import { MODULES } from '../config/permissions.js';
import { idParam, extendListQuery } from '../utils/commonSchemas.js';
import * as v from '../validators/clinicalValidator.js';
import * as safety from '../controllers/clinicalSafetyController.js';
import * as gov from '../controllers/governanceController.js';

const auth = (router) => {
  router.use(requireAuth);
  return router;
};

/* ==========================================================================
 * B1 — TERMINOLOGY
 * ======================================================================= */
export const terminologyRouter = auth(Router());
const canLookup = requirePermission(MODULES.TERMINOLOGY, 'view');

terminologyRouter.get('/status', canLookup, safety.terminologyStatus);
terminologyRouter.get('/search', canLookup, validate({ query: v.terminologySearchQuery }), safety.searchCodes);
terminologyRouter.get('/validate', canLookup, validate({ query: v.terminologyValidateQuery }), safety.validateCode);
terminologyRouter.get('/translate', canLookup, validate({ query: v.terminologyTranslateQuery }), safety.translateCode);

/* ==========================================================================
 * B4 — CRITICAL RESULTS
 * ======================================================================= */
export const criticalRouter = auth(Router());

criticalRouter.get('/board', requirePermission(MODULES.CRITICAL_ALERTS, 'view'), safety.criticalBoard);
criticalRouter.get(
  '/',
  requirePermission(MODULES.CRITICAL_ALERTS, 'view'),
  validate({ query: v.listAlertsQuery }),
  safety.listAlerts,
);
/**
 * Acknowledgement and action are separate endpoints because they are separate
 * facts: seeing a critical result is not treating the patient.
 */
criticalRouter.post(
  '/:id/acknowledge',
  requirePermission(MODULES.CRITICAL_ALERTS, 'acknowledge'),
  validate({ params: idParam, body: v.acknowledgeAlertSchema }),
  audit({ action: 'acknowledge', resourceType: 'CriticalAlert' }),
  safety.acknowledgeAlert,
);
criticalRouter.post(
  '/:id/action',
  requirePermission(MODULES.CRITICAL_ALERTS, 'recordAction'),
  validate({ params: idParam, body: v.alertActionSchema }),
  audit({ action: 'update', resourceType: 'CriticalAlert' }),
  safety.actionAlert,
);

/* ==========================================================================
 * B5 — CONTROLLED DRUGS
 * ======================================================================= */
export const controlledDrugRouter = auth(Router());

controlledDrugRouter.get(
  '/discrepancies',
  requirePermission(MODULES.CONTROLLED_DRUGS, 'view'),
  safety.registerDiscrepancies,
);
controlledDrugRouter.get(
  '/',
  requirePermission(MODULES.CONTROLLED_DRUGS, 'view'),
  validate({ query: v.listRegisterQuery }),
  safety.listRegister,
);
/**
 * There is no update or delete route, and there cannot be: the register is
 * append-only at the model. A correction is a new count-adjustment entry.
 */
controlledDrugRouter.post(
  '/',
  requirePermission(MODULES.CONTROLLED_DRUGS, 'record'),
  validate({ body: v.registerEntrySchema }),
  audit({ action: 'create', resourceType: 'ControlledDrugRegister' }),
  safety.recordRegisterEntry,
);

/* ==========================================================================
 * B6 — MEDICO-LEGAL
 * ======================================================================= */
export const mlcRouter = auth(Router());

/**
 * Reads are audited here and almost nowhere else. An MLC is evidence, and
 * "who looked at this file" is a question that gets asked in court.
 */
mlcRouter.get(
  '/',
  requirePermission(MODULES.MEDICO_LEGAL, 'view'),
  validate({ query: v.listMlcQuery }),
  auditRead({ resourceType: 'MedicoLegalCase' }),
  safety.listMlc,
);
mlcRouter.post(
  '/',
  requirePermission(MODULES.MEDICO_LEGAL, 'create'),
  validate({ body: v.createMlcSchema }),
  audit({ action: 'create', resourceType: 'MedicoLegalCase' }),
  safety.createMlc,
);
mlcRouter.get(
  '/:id',
  requirePermission(MODULES.MEDICO_LEGAL, 'view'),
  validate({ params: idParam }),
  auditRead({ resourceType: 'MedicoLegalCase' }),
  safety.getMlc,
);
mlcRouter.post(
  '/:id/inform-police',
  requirePermission(MODULES.MEDICO_LEGAL, 'informPolice'),
  validate({ params: idParam, body: v.informPoliceSchema }),
  audit({ action: 'update', resourceType: 'MedicoLegalCase' }),
  safety.informPolice,
);

/* ==========================================================================
 * B7 — DEATH AND BIRTH
 * ======================================================================= */
export const deathRouter = auth(Router());

deathRouter.get(
  '/',
  requirePermission(MODULES.DEATH_RECORDS, 'view'),
  validate({ query: extendListQuery({}) }),
  safety.listDeaths,
);
deathRouter.post(
  '/',
  requirePermission(MODULES.DEATH_RECORDS, 'create'),
  validate({ body: v.createDeathSchema }),
  audit({ action: 'create', resourceType: 'DeathRecord' }),
  safety.createDeath,
);
/** Certifying the cause is a doctor's legal act, separate from pronouncing. */
deathRouter.post(
  '/:id/certify',
  requirePermission(MODULES.DEATH_RECORDS, 'certify'),
  validate({ params: idParam, body: v.certifyDeathSchema }),
  audit({ action: 'update', resourceType: 'DeathRecord' }),
  safety.certifyDeath,
);

export const birthRouter = auth(Router());

birthRouter.get(
  '/',
  requirePermission(MODULES.BIRTH_RECORDS, 'view'),
  validate({ query: extendListQuery({}) }),
  safety.listBirths,
);
birthRouter.post(
  '/',
  requirePermission(MODULES.BIRTH_RECORDS, 'create'),
  validate({ body: v.createBirthSchema }),
  audit({ action: 'create', resourceType: 'BirthRecord' }),
  safety.createBirth,
);

/* ==========================================================================
 * B8 — PROBLEMS AND CARE PLANS
 * ======================================================================= */
export const problemRouter = auth(Router());

problemRouter.get(
  '/',
  requirePermission(MODULES.PROBLEMS, 'view'),
  validate({ query: v.listProblemsQuery }),
  gov.listProblems,
);
problemRouter.post(
  '/',
  requirePermission(MODULES.PROBLEMS, 'create'),
  validate({ body: v.createProblemSchema }),
  audit({ action: 'create', resourceType: 'Problem' }),
  gov.createProblem,
);
problemRouter.patch(
  '/:id',
  requirePermission(MODULES.PROBLEMS, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Problem' }),
  gov.updateProblem,
);
problemRouter.post(
  '/:id/resolve',
  requirePermission(MODULES.PROBLEMS, 'resolve'),
  validate({ params: idParam, body: v.resolveProblemSchema }),
  audit({ action: 'update', resourceType: 'Problem' }),
  gov.resolveProblem,
);

export const carePlanRouter = auth(Router());

carePlanRouter.get(
  '/',
  requirePermission(MODULES.CARE_PLANS, 'view'),
  validate({ query: extendListQuery({}) }),
  gov.listCarePlans,
);
carePlanRouter.post(
  '/',
  requirePermission(MODULES.CARE_PLANS, 'create'),
  validate({ body: v.createCarePlanSchema }),
  audit({ action: 'create', resourceType: 'CarePlan' }),
  gov.createCarePlan,
);
carePlanRouter.post(
  '/:id/review',
  requirePermission(MODULES.CARE_PLANS, 'review'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'CarePlan' }),
  gov.reviewCarePlan,
);

/* ==========================================================================
 * B9 — INFECTION CONTROL AND STEWARDSHIP
 * ======================================================================= */
export const infectionRouter = auth(Router());

infectionRouter.get('/rates', requirePermission(MODULES.INFECTION_CONTROL, 'report'), gov.infectionRates);
infectionRouter.get('/antibiogram', requirePermission(MODULES.INFECTION_CONTROL, 'report'), gov.antibiogram);
infectionRouter.get('/isolations', requirePermission(MODULES.INFECTION_CONTROL, 'view'), gov.activeIsolations);

infectionRouter.post(
  '/devices',
  requirePermission(MODULES.INFECTION_CONTROL, 'recordDevice'),
  validate({ body: v.insertDeviceSchema }),
  audit({ action: 'create', resourceType: 'DeviceDay' }),
  gov.insertDevice,
);
infectionRouter.post(
  '/devices/:id/remove',
  requirePermission(MODULES.INFECTION_CONTROL, 'recordDevice'),
  validate({ params: idParam, body: v.removeDeviceSchema }),
  audit({ action: 'update', resourceType: 'DeviceDay' }),
  gov.removeDevice,
);
infectionRouter.post(
  '/hai',
  requirePermission(MODULES.INFECTION_CONTROL, 'reportHai'),
  validate({ body: v.reportHaiSchema }),
  audit({ action: 'create', resourceType: 'HaiCase' }),
  gov.reportHai,
);
infectionRouter.post(
  '/isolations',
  requirePermission(MODULES.INFECTION_CONTROL, 'order'),
  validate({ body: v.isolationSchema }),
  audit({ action: 'create', resourceType: 'IsolationOrder' }),
  gov.orderIsolation,
);

export const stewardshipRouter = auth(Router());

stewardshipRouter.get(
  '/',
  requirePermission(MODULES.ANTIBIOTIC_APPROVALS, 'view'),
  validate({ query: extendListQuery({}) }),
  gov.listAntibioticRequests,
);
stewardshipRouter.post(
  '/',
  requirePermission(MODULES.ANTIBIOTIC_APPROVALS, 'request'),
  validate({ body: v.antibioticRequestSchema }),
  audit({ action: 'create', resourceType: 'AntibioticApproval' }),
  gov.requestAntibiotic,
);
stewardshipRouter.post(
  '/:id/decision',
  requirePermission(MODULES.ANTIBIOTIC_APPROVALS, 'approve'),
  validate({ params: idParam, body: v.antibioticDecisionSchema }),
  audit({ action: 'update', resourceType: 'AntibioticApproval' }),
  gov.decideAntibiotic,
);

/* ==========================================================================
 * B10 — TRANSFUSION
 * ======================================================================= */
export const transfusionRouter = auth(Router());

transfusionRouter.get(
  '/',
  requirePermission(MODULES.TRANSFUSIONS, 'view'),
  validate({ query: extendListQuery({}) }),
  safety.listTransfusions,
);
transfusionRouter.post(
  '/',
  requirePermission(MODULES.TRANSFUSIONS, 'prepare'),
  validate({ body: v.prepareTransfusionSchema }),
  audit({ action: 'create', resourceType: 'Transfusion' }),
  safety.prepareTransfusion,
);
/**
 * The bedside check and the start are one endpoint because they are one act.
 * Two people sign; the model refuses if they are the same person.
 */
transfusionRouter.post(
  '/:id/start',
  requirePermission(MODULES.TRANSFUSIONS, 'check'),
  validate({ params: idParam, body: v.bedsideCheckSchema }),
  audit({ action: 'update', resourceType: 'Transfusion' }),
  safety.checkAndStart,
);
transfusionRouter.post(
  '/:id/observations',
  requirePermission(MODULES.TRANSFUSIONS, 'observe'),
  validate({ params: idParam, body: v.observationSchema }),
  safety.addObservation,
);
transfusionRouter.post(
  '/:id/reaction',
  requirePermission(MODULES.TRANSFUSIONS, 'reportReaction'),
  validate({ params: idParam, body: v.reactionSchema }),
  audit({ action: 'create', resourceType: 'TransfusionReaction' }),
  safety.reportReaction,
);

/* ==========================================================================
 * B11 — GOVERNANCE
 * ======================================================================= */
export const incidentRouter = auth(Router());

incidentRouter.get('/trends', requirePermission(MODULES.INCIDENTS, 'review'), gov.incidentTrends);
incidentRouter.get(
  '/',
  requirePermission(MODULES.INCIDENTS, 'view'),
  validate({ query: v.listIncidentsQuery }),
  gov.listIncidents,
);
/**
 * NOT audited with the actor, deliberately.
 *
 * The audit middleware records who performed a write. On an anonymous incident
 * report that would defeat the anonymity the model just went to the trouble of
 * enforcing — the reporter's identity would simply move from one collection to
 * another.
 */
incidentRouter.post(
  '/',
  requirePermission(MODULES.INCIDENTS, 'report'),
  validate({ body: v.createIncidentSchema }),
  gov.reportIncident,
);
incidentRouter.post(
  '/:id/investigate',
  requirePermission(MODULES.INCIDENTS, 'investigate'),
  validate({ params: idParam, body: v.investigateIncidentSchema }),
  audit({ action: 'update', resourceType: 'IncidentReport' }),
  gov.investigateIncident,
);

export const complaintRouter = auth(Router());

complaintRouter.get(
  '/',
  requirePermission(MODULES.COMPLAINTS, 'view'),
  validate({ query: v.listComplaintsQuery }),
  gov.listComplaints,
);
complaintRouter.post(
  '/',
  requirePermission(MODULES.COMPLAINTS, 'create'),
  validate({ body: v.createComplaintSchema }),
  audit({ action: 'create', resourceType: 'Complaint' }),
  gov.createComplaint,
);
complaintRouter.post(
  '/:id/resolve',
  requirePermission(MODULES.COMPLAINTS, 'resolve'),
  validate({ params: idParam, body: v.resolveComplaintSchema }),
  audit({ action: 'update', resourceType: 'Complaint' }),
  gov.resolveComplaint,
);

/* ==========================================================================
 * C1 — REFERRALS
 * ======================================================================= */
export const referralRouter = auth(Router());

/** Literal paths before `/:id` — Express matches in order. */
referralRouter.get('/open-loop', requirePermission(MODULES.REFERRALS, 'view'), gov.openReferralLoop);
referralRouter.get(
  '/',
  requirePermission(MODULES.REFERRALS, 'view'),
  validate({ query: v.listReferralsQuery }),
  gov.listReferrals,
);
referralRouter.post(
  '/',
  requirePermission(MODULES.REFERRALS, 'create'),
  validate({ body: v.createReferralSchema }),
  audit({ action: 'create', resourceType: 'Referral' }),
  gov.createReferral,
);
referralRouter.get(
  '/:id',
  requirePermission(MODULES.REFERRALS, 'view'),
  validate({ params: idParam }),
  gov.getReferral,
);
referralRouter.post(
  '/:id/issue',
  requirePermission(MODULES.REFERRALS, 'issue'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Referral' }),
  gov.issueReferral,
);
referralRouter.post(
  '/:id/outcome',
  requirePermission(MODULES.REFERRALS, 'recordOutcome'),
  validate({ params: idParam, body: v.referralOutcomeSchema }),
  audit({ action: 'update', resourceType: 'Referral' }),
  gov.recordOutcome,
);
