import { Router } from 'express';
import requireAuth from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import validate from '../../middleware/validate.js';
import audit from '../../middleware/audit.js';
import { MODULES } from '../../config/permissions.js';
import { idParam } from '../../utils/commonSchemas.js';
import {
  listEncountersQuery,
  createEncounterSchema,
  updateEncounterSchema,
  closeEncounterSchema,
} from './encounters.validation.js';
import * as controller from './encounters.controller.js';

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
