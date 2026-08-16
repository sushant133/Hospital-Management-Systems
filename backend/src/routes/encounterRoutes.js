import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import auditRead from '../middleware/auditRead.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listEncountersQuery,
  createEncounterSchema,
  updateEncounterSchema,
  closeEncounterSchema,
} from '../validators/encounterValidator.js';
import { recordVitalsSchema } from '../validators/ehrValidator.js';
import {
  admitSchema,
  transferSchema,
  dischargeSchema,
  recordRoundSchema,
} from '../validators/admissionValidator.js';
import * as controller from '../controllers/encounterController.js';
import * as ehr from '../controllers/ehrController.js';
import * as admission from '../controllers/admissionController.js';

const router = Router();

router.use(requireAuth);

const ENCOUNTERS = MODULES.ENCOUNTERS;

// Downstream roles (lab, radiology, pharmacy, accounts) need to read visits to
// attach their own artifacts to one.
router.get(
  '/',
  requirePermission(ENCOUNTERS, 'view'),
  validate({ query: listEncountersQuery }),
  controller.listEncounters,
);

router.get(
  '/:id',
  requirePermission(ENCOUNTERS, 'view'),
  validate({ params: idParam }),
  auditRead({ resourceType: 'Encounter' }),
  controller.getEncounter,
);

// Reception opens visits at check-in; clinical staff open them directly.
router.post(
  '/',
  requirePermission(ENCOUNTERS, 'create'),
  validate({ body: createEncounterSchema }),
  audit({ action: 'create', resourceType: 'Encounter' }),
  controller.createEncounter,
);

// Clinical content (diagnosis, vitals, notes) is clinical-roles only.
router.patch(
  '/:id',
  requirePermission(ENCOUNTERS, 'edit'),
  validate({ params: idParam, body: updateEncounterSchema }),
  audit({ action: 'update', resourceType: 'Encounter' }),
  controller.updateEncounter,
);

// --- Observations (Phase 3) ---
// `recordVitals` is narrower than `edit`: a nurse may add observations to a
// visit without being able to change its department, doctor or diagnoses.
router.get(
  '/:id/vitals',
  requirePermission(ENCOUNTERS, 'view'),
  validate({ params: idParam }),
  ehr.listEncounterVitals,
);

router.post(
  '/:id/vitals',
  requirePermission(ENCOUNTERS, 'recordVitals'),
  validate({ params: idParam, body: recordVitalsSchema }),
  audit({ action: 'create', resourceType: 'VitalSigns' }),
  ehr.recordVitals,
);

// --- Admission workflow (Phase 4) ---
// Admitting and transferring are gated on `beds.assign`: putting a patient
// into a bed is the act being controlled, and the matrix already names it.
router.post(
  '/:id/admit',
  requirePermission(MODULES.BEDS, 'assign'),
  validate({ params: idParam, body: admitSchema }),
  audit({ action: 'update', resourceType: 'Encounter' }),
  admission.admitPatient,
);

router.post(
  '/:id/transfer',
  requirePermission(MODULES.BEDS, 'assign'),
  validate({ params: idParam, body: transferSchema }),
  audit({ action: 'update', resourceType: 'Encounter' }),
  admission.transferPatient,
);

// Discharge is a clinical sign-off, and it settles the bed charges.
router.post(
  '/:id/discharge',
  requirePermission(ENCOUNTERS, 'close'),
  validate({ params: idParam, body: dischargeSchema }),
  audit({ action: 'update', resourceType: 'Encounter' }),
  admission.dischargePatient,
);

// --- Ward rounds ---
router.get(
  '/:id/rounds',
  requirePermission(ENCOUNTERS, 'view'),
  validate({ params: idParam }),
  admission.listRounds,
);

router.post(
  '/:id/rounds',
  requirePermission(ENCOUNTERS, 'recordRound'),
  validate({ params: idParam, body: recordRoundSchema }),
  audit({ action: 'create', resourceType: 'NursingRound' }),
  admission.recordRound,
);

router.post(
  '/:id/close',
  requirePermission(ENCOUNTERS, 'close'),
  validate({ params: idParam, body: closeEncounterSchema }),
  audit({ action: 'update', resourceType: 'Encounter' }),
  controller.closeEncounter,
);

router.delete(
  '/:id',
  requirePermission(ENCOUNTERS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Encounter' }),
  controller.cancelEncounter,
);

export default router;
