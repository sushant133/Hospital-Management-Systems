import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listDrugsQuery,
  createDrugSchema,
  updateDrugSchema,
  listBatchesQuery,
  receiveBatchSchema,
  adjustBatchSchema,
  alertsQuery,
  listPrescriptionsQuery,
  createPrescriptionSchema,
  cancelPrescriptionSchema,
  dispenseSchema,
  listDispensesQuery,
  returnDispenseSchema,
} from '../validators/pharmacyValidator.js';
import * as drugs from '../controllers/drugController.js';
import * as pharmacy from '../controllers/pharmacyController.js';

const router = Router();

router.use(requireAuth);

const DRUGS = MODULES.DRUGS;
const BATCHES = MODULES.DRUG_BATCHES;
const PRESCRIPTIONS = MODULES.PRESCRIPTIONS;
const DISPENSING = MODULES.DISPENSING;

/** Literal paths are declared before '/:id' so they are not read as ids. */

// --- Alerts: expiry and low stock ---
router.get(
  '/alerts',
  requirePermission(BATCHES, 'view'),
  validate({ query: alertsQuery }),
  drugs.getAlerts,
);

// --- Stock batches ---
router.get(
  '/batches',
  requirePermission(BATCHES, 'view'),
  validate({ query: listBatchesQuery }),
  drugs.listBatches,
);

router.post(
  '/batches',
  requirePermission(BATCHES, 'create'),
  validate({ body: receiveBatchSchema }),
  audit({ action: 'create', resourceType: 'DrugBatch' }),
  drugs.receiveBatch,
);

// Writing stock off is gated apart from `edit`: correcting a supplier name and
// destroying stock are not the same act.
router.post(
  '/batches/:id/adjust',
  requirePermission(BATCHES, 'adjust'),
  validate({ params: idParam, body: adjustBatchSchema }),
  audit({ action: 'update', resourceType: 'DrugBatch' }),
  drugs.adjustBatch,
);

// --- Prescriptions ---
router.get(
  '/prescriptions',
  requirePermission(PRESCRIPTIONS, 'view'),
  validate({ query: listPrescriptionsQuery }),
  pharmacy.listPrescriptions,
);

router.post(
  '/prescriptions',
  requirePermission(PRESCRIPTIONS, 'create'),
  validate({ body: createPrescriptionSchema }),
  audit({ action: 'create', resourceType: 'Prescription' }),
  pharmacy.createPrescription,
);

router.get(
  '/prescriptions/:id',
  requirePermission(PRESCRIPTIONS, 'view'),
  validate({ params: idParam }),
  pharmacy.getPrescription,
);

router.post(
  '/prescriptions/:id/cancel',
  requirePermission(PRESCRIPTIONS, 'cancel'),
  validate({ params: idParam, body: cancelPrescriptionSchema }),
  audit({ action: 'cancel', resourceType: 'Prescription' }),
  pharmacy.cancelPrescription,
);

/** What FEFO would draw, and which warnings stand — before anything moves. */
router.get(
  '/prescriptions/:id/dispense-preview',
  requirePermission(DISPENSING, 'view'),
  validate({ params: idParam }),
  pharmacy.previewDispense,
);

// The allergy check gates this route; overriding it needs its own permission,
// re-checked in the controller.
router.post(
  '/prescriptions/:id/dispense',
  requirePermission(DISPENSING, 'create'),
  validate({ params: idParam, body: dispenseSchema }),
  audit({ action: 'dispense', resourceType: 'Dispense' }),
  pharmacy.dispensePrescription,
);

// --- Dispenses ---
router.get(
  '/dispenses',
  requirePermission(DISPENSING, 'view'),
  validate({ query: listDispensesQuery }),
  pharmacy.listDispenses,
);

router.post(
  '/dispenses/:id/return',
  requirePermission(DISPENSING, 'return'),
  validate({ params: idParam, body: returnDispenseSchema }),
  audit({ action: 'update', resourceType: 'Dispense' }),
  pharmacy.returnDispense,
);

// --- Drug master (declared last: '/drugs/:id' must not shadow the above) ---
router.get(
  '/drugs',
  requirePermission(DRUGS, 'view'),
  validate({ query: listDrugsQuery }),
  drugs.listDrugs,
);

router.post(
  '/drugs',
  requirePermission(DRUGS, 'create'),
  validate({ body: createDrugSchema }),
  audit({ action: 'create', resourceType: 'Drug' }),
  drugs.createDrug,
);

router.get(
  '/drugs/:id',
  requirePermission(DRUGS, 'view'),
  validate({ params: idParam }),
  drugs.getDrug,
);

router.patch(
  '/drugs/:id',
  requirePermission(DRUGS, 'edit'),
  validate({ params: idParam, body: updateDrugSchema }),
  audit({ action: 'update', resourceType: 'Drug' }),
  drugs.updateDrug,
);

router.delete(
  '/drugs/:id',
  requirePermission(DRUGS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Drug' }),
  drugs.deleteDrug,
);

export default router;
