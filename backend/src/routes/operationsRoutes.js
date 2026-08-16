import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam, extendListQuery, objectId, optionalObjectId, nonEmptyString, optionalString, dateField, optionalDate } from '../utils/commonSchemas.js';
import { QUEUE_PRIORITIES, TOKEN_STATUSES } from '../models/OpdQueue.js';
import { TRIP_TYPES, TRIP_STATUSES } from '../models/Ambulance.js';
import { FILE_LOCATIONS, RELEASE_REQUESTERS, RELEASE_STATUSES } from '../models/MedicalRecords.js';
import { DIET_TYPES, MEAL_TIMES, TASK_TYPES, TASK_STATUSES, WASTE_CATEGORY_VALUES, DISPOSAL_METHODS } from '../models/SupportServices.js';
import { CYCLE_TYPES, INDICATOR_RESULTS } from '../models/AssetsAndSterilisation.js';
import { THERAPY_DISCIPLINES, THERAPY_SESSION_STATUSES, TELE_MODALITIES, TELE_STATUSES } from '../models/TherapyAndRemote.js';
import * as ops from '../controllers/operationsController.js';

const listQuery = extendListQuery({ status: optionalString(40) });

/* ==========================================================================
 * C2 — OPD QUEUE
 * ======================================================================= */
export const queueRouter = Router();

/**
 * The display board is the one endpoint here that does NOT require a session.
 *
 * It runs on a television in the waiting hall — there is no user to
 * authenticate, and demanding one would simply mean the TV runs a permanently
 * logged-in account, which is worse. What makes it safe is that the handler
 * returns token numbers and counter names only: no patient name, no MRN, no
 * reason for attendance ever leaves it.
 */
queueRouter.get('/board', ops.displayBoard);

queueRouter.use(requireAuth);

queueRouter.post(
  '/tokens',
  requirePermission(MODULES.OPD_QUEUE, 'issue'),
  validate({
    body: z.object({
      patientId: objectId,
      departmentId: objectId,
      doctorId: optionalObjectId,
      appointmentId: optionalObjectId,
      priority: z.enum(QUEUE_PRIORITIES).optional(),
      priorityReason: optionalString(200),
    }),
  }),
  audit({ action: 'create', resourceType: 'OpdToken' }),
  ops.issueToken,
);
queueRouter.post(
  '/call-next',
  requirePermission(MODULES.OPD_QUEUE, 'call'),
  validate({ body: z.object({ departmentId: objectId, counterName: nonEmptyString(60, 'Counter') }) }),
  ops.callNext,
);
queueRouter.patch(
  '/tokens/:id',
  requirePermission(MODULES.OPD_QUEUE, 'call'),
  validate({ params: idParam, body: z.object({ status: z.enum(TOKEN_STATUSES) }) }),
  ops.updateToken,
);

/* ==========================================================================
 * C3 — AMBULANCE
 * ======================================================================= */
export const ambulanceRouter = Router();
ambulanceRouter.use(requireAuth);

ambulanceRouter.get('/', requirePermission(MODULES.AMBULANCE, 'view'), validate({ query: listQuery }), ops.listAmbulances);
ambulanceRouter.get('/trips', requirePermission(MODULES.AMBULANCE, 'view'), validate({ query: listQuery }), ops.listTrips);
ambulanceRouter.post(
  '/trips',
  requirePermission(MODULES.AMBULANCE, 'dispatch'),
  validate({
    body: z.object({
      ambulanceId: objectId,
      tripType: z.enum(TRIP_TYPES),
      patientId: optionalObjectId,
      encounterId: optionalObjectId,
      referralId: optionalObjectId,
      fromLocation: nonEmptyString(300, 'From'),
      toLocation: nonEmptyString(300, 'To'),
      driverName: optionalString(200),
      callerName: optionalString(200),
      callerPhone: optionalString(60),
    }),
  }),
  audit({ action: 'create', resourceType: 'AmbulanceTrip' }),
  ops.dispatchTrip,
);
ambulanceRouter.patch(
  '/trips/:id',
  requirePermission(MODULES.AMBULANCE, 'updateTrip'),
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(TRIP_STATUSES).optional(),
      arrivedAtSceneAt: optionalDate,
      departedSceneAt: optionalDate,
      arrivedAtDestinationAt: optionalDate,
      completedAt: optionalDate,
      odometerEndKm: z.coerce.number().min(0).optional(),
      clinicalNotes: optionalString(2000),
      chargeAmount: z.coerce.number().min(0).optional(),
    }),
  }),
  audit({ action: 'update', resourceType: 'AmbulanceTrip' }),
  ops.updateTrip,
);

/* ==========================================================================
 * C4 — DIALYSIS
 * ======================================================================= */
export const dialysisRouter = Router();
dialysisRouter.use(requireAuth);

dialysisRouter.get('/machines', requirePermission(MODULES.DIALYSIS, 'view'), validate({ query: listQuery }), ops.listMachines);
dialysisRouter.get('/unclaimed', requirePermission(MODULES.DIALYSIS, 'view'), ops.unclaimedDialysis);
dialysisRouter.post(
  '/sessions',
  requirePermission(MODULES.DIALYSIS, 'schedule'),
  validate({
    body: z.object({
      patientId: objectId,
      machineId: optionalObjectId,
      encounterId: optionalObjectId,
      scheduledFor: dateField,
      prescribedMinutes: z.coerce.number().min(0).optional(),
    }),
  }),
  audit({ action: 'create', resourceType: 'DialysisSession' }),
  ops.scheduleDialysis,
);
dialysisRouter.patch(
  '/sessions/:id',
  requirePermission(MODULES.DIALYSIS, 'recordSession'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'DialysisSession' }),
  ops.recordDialysisSession,
);

/* ==========================================================================
 * C5 — MEDICAL RECORDS
 * ======================================================================= */
export const recordsRouter = Router();
recordsRouter.use(requireAuth);

recordsRouter.get('/files/overdue', requirePermission(MODULES.MEDICAL_RECORDS, 'view'), ops.overdueFiles);
recordsRouter.post(
  '/files/move',
  requirePermission(MODULES.MEDICAL_RECORDS, 'trackFile'),
  validate({
    body: z.object({
      patientId: objectId,
      fileNumber: optionalString(40),
      to: z.enum(FILE_LOCATIONS),
      purpose: optionalString(200),
      dueBack: optionalDate,
    }),
  }),
  audit({ action: 'update', resourceType: 'PatientFile' }),
  ops.moveFile,
);

recordsRouter.get('/releases', requirePermission(MODULES.MEDICAL_RECORDS, 'view'), validate({ query: listQuery }), ops.listReleases);
recordsRouter.post(
  '/releases',
  requirePermission(MODULES.MEDICAL_RECORDS, 'requestRelease'),
  validate({
    body: z.object({
      patientId: objectId,
      requesterType: z.enum(RELEASE_REQUESTERS),
      requesterName: nonEmptyString(200, 'Requester'),
      requesterOrganisation: optionalString(200),
      requesterContact: optionalString(60),
      requesterIdShown: optionalString(100),
      purpose: nonEmptyString(500, 'Purpose'),
      recordsRequested: z.array(z.string().trim()).optional(),
      consentObtained: z.boolean().optional(),
      legalBasis: optionalString(300),
    }),
  }),
  audit({ action: 'create', resourceType: 'RecordRelease' }),
  ops.createReleaseRequest,
);
/**
 * Approval is admin-only. The model already refuses a release with neither
 * consent nor a legal basis, so this gate is about who makes the judgement
 * call, not about catching the obvious case.
 */
recordsRouter.post(
  '/releases/:id/decision',
  requirePermission(MODULES.MEDICAL_RECORDS, 'approveRelease'),
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(RELEASE_STATUSES),
      decisionNote: optionalString(1000),
      withheldItems: z.array(z.string().trim()).optional(),
      refusalReason: optionalString(500),
    }),
  }),
  audit({ action: 'update', resourceType: 'RecordRelease' }),
  ops.decideRelease,
);

recordsRouter.get('/coding', requirePermission(MODULES.MEDICAL_RECORDS, 'code'), validate({ query: listQuery }), ops.codingWorklist);
recordsRouter.post(
  '/coding/:id/complete',
  requirePermission(MODULES.MEDICAL_RECORDS, 'code'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'CodingTask' }),
  ops.completeCoding,
);

/* ==========================================================================
 * C6 / C9 — DIET, HOUSEKEEPING, WASTE
 * ======================================================================= */
export const dietRouter = Router();
dietRouter.use(requireAuth);

dietRouter.get('/kitchen-count', requirePermission(MODULES.DIETARY, 'kitchenReport'), ops.kitchenCount);
dietRouter.post(
  '/orders',
  requirePermission(MODULES.DIETARY, 'order'),
  validate({
    body: z.object({
      patientId: objectId,
      encounterId: objectId,
      wardId: optionalObjectId,
      bedId: optionalObjectId,
      dietType: z.enum(DIET_TYPES),
      specification: optionalString(500),
      caloriesPerDay: z.coerce.number().min(0).optional(),
      fluidRestrictionMl: z.coerce.number().min(0).optional(),
      meals: z.array(z.enum(MEAL_TIMES)).optional(),
      nilByMouthFrom: optionalDate,
      nilByMouthReason: optionalString(200),
      culturalRestriction: optionalString(200),
    }),
  }),
  audit({ action: 'create', resourceType: 'DietOrder' }),
  ops.orderDiet,
);

export const housekeepingRouter = Router();
housekeepingRouter.use(requireAuth);

housekeepingRouter.get('/', requirePermission(MODULES.HOUSEKEEPING, 'view'), validate({ query: listQuery }), ops.listHousekeeping);
housekeepingRouter.post(
  '/',
  requirePermission(MODULES.HOUSEKEEPING, 'raise'),
  validate({
    body: z.object({
      taskType: z.enum(TASK_TYPES),
      wardId: optionalObjectId,
      bedId: optionalObjectId,
      encounterId: optionalObjectId,
      location: optionalString(200),
      isolationType: optionalString(40),
      priority: z.enum(['urgent', 'normal', 'low']).optional(),
      notes: optionalString(500),
    }),
  }),
  ops.raiseHousekeepingTask,
);
housekeepingRouter.patch(
  '/:id',
  requirePermission(MODULES.HOUSEKEEPING, 'complete'),
  validate({ params: idParam, body: z.object({ status: z.enum(TASK_STATUSES), notes: optionalString(500) }) }),
  ops.updateHousekeepingTask,
);

export const wasteRouter = Router();
wasteRouter.use(requireAuth);

wasteRouter.get('/report', requirePermission(MODULES.WASTE, 'view'), ops.wasteReport);
wasteRouter.post(
  '/',
  requirePermission(MODULES.WASTE, 'record'),
  validate({
    body: z.object({
      category: z.enum(WASTE_CATEGORY_VALUES),
      wardId: optionalObjectId,
      sourceLocation: optionalString(200),
      weightKg: z.coerce.number().min(0),
      containerCount: z.coerce.number().min(0).optional(),
      disposalMethod: z.enum(DISPOSAL_METHODS).optional(),
      contractorName: optionalString(200),
      manifestNumber: optionalString(80),
      segregationBreach: z.boolean().optional(),
      breachNote: optionalString(500),
    }),
  }),
  ops.recordWaste,
);

/* ==========================================================================
 * C7 / C8 — CSSD AND ASSETS
 * ======================================================================= */
export const cssdRouter = Router();
cssdRouter.use(requireAuth);

cssdRouter.post(
  '/cycles',
  requirePermission(MODULES.CSSD, 'runCycle'),
  validate({
    body: z.object({
      autoclaveId: nonEmptyString(40, 'Autoclave'),
      cycleType: z.enum(CYCLE_TYPES),
      startedAt: dateField,
      temperatureC: z.coerce.number().optional(),
      pressureBar: z.coerce.number().optional(),
      holdMinutes: z.coerce.number().optional(),
      loadContents: z.array(z.string().trim()).optional(),
    }),
  }),
  audit({ action: 'create', resourceType: 'SterilisationCycle' }),
  ops.runCycle,
);
/** Reading the biological indicator releases or quarantines the whole load. */
cssdRouter.post(
  '/cycles/:id/indicator',
  requirePermission(MODULES.CSSD, 'releaseLoad'),
  validate({ params: idParam, body: z.object({ biologicalIndicator: z.enum(INDICATOR_RESULTS) }) }),
  audit({ action: 'update', resourceType: 'SterilisationCycle' }),
  ops.readIndicator,
);

export const assetRouter = Router();
assetRouter.use(requireAuth);

assetRouter.get('/due', requirePermission(MODULES.ASSETS, 'view'), ops.assetsDue);
assetRouter.get('/', requirePermission(MODULES.ASSETS, 'view'), validate({ query: listQuery }), ops.listAssets);
assetRouter.post(
  '/faults',
  requirePermission(MODULES.ASSETS, 'reportFault'),
  validate({
    body: z.object({
      assetId: objectId,
      maintenanceType: z.enum(['preventive', 'corrective', 'calibration', 'inspection']).optional(),
      faultDescription: nonEmptyString(1000, 'Fault'),
      assetOutOfService: z.boolean().optional(),
      priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
    }),
  }),
  audit({ action: 'create', resourceType: 'MaintenanceTask' }),
  ops.reportFault,
);
assetRouter.post(
  '/maintenance/:id/complete',
  requirePermission(MODULES.ASSETS, 'maintain'),
  validate({
    params: idParam,
    body: z.object({
      workDone: nonEmptyString(1000, 'Work done'),
      partsUsed: z.array(z.string().trim()).optional(),
      cost: z.coerce.number().min(0).optional(),
      coveredByWarranty: z.boolean().optional(),
      coveredByAmc: z.boolean().optional(),
      nextServiceDue: optionalDate,
    }),
  }),
  audit({ action: 'update', resourceType: 'MaintenanceTask' }),
  ops.completeMaintenance,
);

/* ==========================================================================
 * C10 / C11 / C12
 * ======================================================================= */
export const therapyRouter = Router();
therapyRouter.use(requireAuth);

therapyRouter.get('/', requirePermission(MODULES.THERAPY, 'view'), validate({ query: listQuery }), ops.listTherapyCourses);
therapyRouter.post(
  '/',
  requirePermission(MODULES.THERAPY, 'refer'),
  validate({
    body: z.object({
      patientId: objectId,
      encounterId: optionalObjectId,
      discipline: z.enum(THERAPY_DISCIPLINES),
      indication: nonEmptyString(500, 'Indication'),
      plannedSessions: z.coerce.number().int().min(1).optional(),
      outcomeMeasure: optionalString(120),
      baselineScore: z.coerce.number().optional(),
      targetScore: z.coerce.number().optional(),
      goals: z.array(z.string().trim()).optional(),
      treatmentPlan: optionalString(2000),
    }),
  }),
  audit({ action: 'create', resourceType: 'TherapyCourse' }),
  ops.createTherapyCourse,
);
therapyRouter.post(
  '/sessions',
  requirePermission(MODULES.THERAPY, 'recordSession'),
  validate({
    body: z.object({
      courseId: objectId,
      sessionNumber: z.coerce.number().int().min(1),
      scheduledFor: dateField,
      status: z.enum(THERAPY_SESSION_STATUSES).optional(),
      durationMinutes: z.coerce.number().min(0).optional(),
      interventions: z.array(z.string().trim()).optional(),
      progressNote: optionalString(2000),
      scoreThisSession: z.coerce.number().optional(),
      homeProgramme: optionalString(1000),
    }),
  }),
  ops.recordTherapySession,
);

export const mortuaryRouter = Router();
mortuaryRouter.use(requireAuth);

mortuaryRouter.get('/', requirePermission(MODULES.MORTUARY, 'view'), validate({ query: listQuery }), ops.listMortuary);
mortuaryRouter.post(
  '/',
  requirePermission(MODULES.MORTUARY, 'receive'),
  validate({
    body: z.object({
      patientId: optionalObjectId,
      deathRecordId: optionalObjectId,
      medicoLegalCaseId: optionalObjectId,
      isUnidentified: z.boolean().optional(),
      descriptionIfUnidentified: optionalString(1000),
      deceasedName: optionalString(200),
      receivedFrom: optionalString(200),
      storageUnit: optionalString(40),
      postMortemRequired: z.boolean().optional(),
    }),
  }),
  audit({ action: 'create', resourceType: 'MortuaryRecord' }),
  ops.receiveBody,
);
/**
 * Release requires identity, a witness and — for a medico-legal case — police
 * clearance. All three are enforced at the model, where no code path can skip
 * them; releasing a body to the wrong family is unrecoverable.
 */
mortuaryRouter.post(
  '/:id/release',
  requirePermission(MODULES.MORTUARY, 'release'),
  validate({
    params: idParam,
    body: z.object({
      releasedTo: nonEmptyString(200, 'Released to'),
      releasedToRelation: nonEmptyString(100, 'Relationship'),
      releasedToIdType: nonEmptyString(60, 'Identity document type'),
      releasedToIdNumber: nonEmptyString(60, 'Identity document number'),
      releaseWitnessedBy: objectId,
      policeClearanceObtained: z.boolean().optional(),
      policeClearanceRef: optionalString(100),
    }),
  }),
  audit({ action: 'update', resourceType: 'MortuaryRecord' }),
  ops.releaseBody,
);

export const teleRouter = Router();
teleRouter.use(requireAuth);

teleRouter.get('/', requirePermission(MODULES.TELEMEDICINE, 'view'), validate({ query: listQuery }), ops.listTeleconsultations);
teleRouter.post(
  '/',
  requirePermission(MODULES.TELEMEDICINE, 'schedule'),
  validate({
    body: z.object({
      patientId: objectId,
      encounterId: optionalObjectId,
      appointmentId: optionalObjectId,
      clinicianId: optionalObjectId,
      modality: z.enum(TELE_MODALITIES).optional(),
      scheduledFor: dateField,
      remoteSiteName: optionalString(200),
      remoteFacilityCode: optionalString(60),
      remoteAttendantName: optionalString(200),
      reasonForConsultation: optionalString(1000),
      consentObtained: z.boolean().optional(),
    }),
  }),
  audit({ action: 'create', resourceType: 'Teleconsultation' }),
  ops.scheduleTeleconsultation,
);
teleRouter.patch(
  '/:id',
  requirePermission(MODULES.TELEMEDICINE, 'consult'),
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(TELE_STATUSES).optional(),
      connectionQuality: z.enum(['good', 'fair', 'poor']).optional(),
      degradedToAudio: z.boolean().optional(),
      technicalIssues: optionalString(1000),
      outcome: z.enum(['managed-remotely', 'referred-in', 'referred-elsewhere', 'follow-up-scheduled', 'inconclusive']).optional(),
      referralId: optionalObjectId,
    }),
  }),
  audit({ action: 'update', resourceType: 'Teleconsultation' }),
  ops.updateTeleconsultation,
);
