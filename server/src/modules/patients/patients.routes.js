import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import validate from '../../middleware/validate.js';
import audit from '../../middleware/audit.js';
import { MODULES } from '../../config/permissions.js';
import { idParam, extendListQuery } from '../../utils/commonSchemas.js';
import {
  listPatientsQuery,
  createPatientSchema,
  updatePatientSchema,
  updateMedicalHistorySchema,
  checkDuplicatesSchema,
} from './patients.validation.js';
import * as controller from './patients.controller.js';

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

export default router;
