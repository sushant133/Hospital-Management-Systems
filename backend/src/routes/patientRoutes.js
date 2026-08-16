import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import auditRead from '../middleware/auditRead.js';
import { MODULES } from '../config/permissions.js';
import { idParam, extendListQuery } from '../utils/commonSchemas.js';
import {
  listPatientsQuery,
  createPatientSchema,
  updatePatientSchema,
  updateMedicalHistorySchema,
  checkDuplicatesSchema,
  mergePatientsSchema,
} from '../validators/patientValidator.js';
import { patientVitalsQuery, timelineQuery } from '../validators/ehrValidator.js';
import * as controller from '../controllers/patientController.js';
import * as ehr from '../controllers/ehrController.js';
import { invite as invitePortal } from '../controllers/portalController.js';
import { invitePortalSchema } from '../validators/tier23Validator.js';

const router = Router();

router.use(requireAuth);

const PATIENTS = MODULES.PATIENTS;

const encounterHistoryQuery = extendListQuery({
  status: z.enum(['open', 'admitted', 'discharged', 'cancelled']).optional(),
  type: z.enum(['opd', 'ipd', 'emergency', 'daycare']).optional(),
});

// --- Master patient index ---
router.get(
  '/',
  requirePermission(PATIENTS, 'view'),
  validate({ query: listPatientsQuery }),
  controller.listPatients,
);

/** Duplicate search on its own — no record is created, so nothing is audited. */
router.post(
  '/check-duplicates',
  requirePermission(PATIENTS, 'checkDuplicates'),
  validate({ body: checkDuplicatesSchema }),
  controller.checkDuplicates,
);

router.post(
  '/',
  requirePermission(PATIENTS, 'create'),
  validate({ body: createPatientSchema }),
  audit({ action: 'create', resourceType: 'Patient' }),
  controller.createPatient,
);

router.get(
  '/:id',
  requirePermission(PATIENTS, 'view'),
  validate({ params: idParam }),
  auditRead({ resourceType: 'Patient' }),
  controller.getPatient,
);

router.patch(
  '/:id',
  requirePermission(PATIENTS, 'edit'),
  validate({ params: idParam, body: updatePatientSchema }),
  audit({ action: 'update', resourceType: 'Patient' }),
  controller.updatePatient,
);

// --- Clinical data: narrower than demographics ---
router.patch(
  '/:id/medical-history',
  requirePermission(PATIENTS, 'editMedicalHistory'),
  validate({ params: idParam, body: updateMedicalHistorySchema }),
  audit({ action: 'update', resourceType: 'Patient.medicalHistory' }),
  controller.updateMedicalHistory,
);

router.get(
  '/:id/encounters',
  requirePermission(PATIENTS, 'view'),
  validate({ params: idParam, query: encounterHistoryQuery }),
  controller.listPatientEncounters,
);

// --- The clinical record (Phase 3) ---
// The observation series across every visit — the vitals trend.
router.get(
  '/:id/vitals',
  requirePermission(PATIENTS, 'viewMedicalHistory'),
  validate({ params: idParam, query: patientVitalsQuery }),
  ehr.listPatientVitals,
);

/**
 * The unified timeline. Gated only on being able to read the patient at all —
 * timelineService filters every strand by the caller's own grants, so a
 * receptionist sees that a visit happened without seeing the note written in it.
 */
router.get(
  '/:id/timeline',
  requirePermission(PATIENTS, 'view'),
  validate({ params: idParam, query: timelineQuery }),
  ehr.getPatientTimeline,
);

// --- Lifecycle ---
router.delete(
  '/:id',
  requirePermission(PATIENTS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Patient' }),
  controller.deletePatient,
);

router.patch(
  '/:id/restore',
  requirePermission(PATIENTS, 'restore'),
  validate({ params: idParam }),
  audit({ action: 'restore', resourceType: 'Patient' }),
  controller.restorePatient,
);

router.post(
  '/:id/merge',
  requirePermission(PATIENTS, 'merge'),
  validate({ params: idParam, body: mergePatientsSchema }),
  audit({ action: 'merge', resourceType: 'Patient' }),
  controller.mergePatients,
);

router.post(
  '/:id/portal-invite',
  requirePermission(MODULES.PORTAL, 'invite'),
  validate({ params: idParam, body: invitePortalSchema }),
  audit({ action: 'create', resourceType: 'PatientPortalAccount' }),
  invitePortal,
);

export default router;
