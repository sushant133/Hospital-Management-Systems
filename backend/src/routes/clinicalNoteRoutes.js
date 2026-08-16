import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import auditRead from '../middleware/auditRead.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listNotesQuery,
  createNoteSchema,
  amendNoteSchema,
} from '../validators/clinicalNoteValidator.js';
import * as controller from '../controllers/clinicalNoteController.js';

const router = Router();

router.use(requireAuth);

const NOTES = MODULES.CLINICAL_NOTES;

/**
 * There is deliberately **no PATCH and no DELETE** on this router.
 *
 * `clinicalNotes` defines only view / create / amend in the permission matrix,
 * so `requirePermission(NOTES, 'edit')` would throw at boot — the matrix
 * validates every (module, action) pair on startup. Corrections go through
 * /amend, which writes a new version and leaves the original readable.
 */

router.get(
  '/',
  requirePermission(NOTES, 'view'),
  validate({ query: listNotesQuery }),
  controller.listNotes,
);

router.post(
  '/',
  requirePermission(NOTES, 'create'),
  validate({ body: createNoteSchema }),
  audit({ action: 'create', resourceType: 'ClinicalNote' }),
  controller.createNote,
);

router.get(
  '/:id',
  requirePermission(NOTES, 'view'),
  validate({ params: idParam }),
  auditRead({ resourceType: 'ClinicalNote' }),
  controller.getNote,
);

/** Every version of a note, oldest first. */
router.get(
  '/:id/history',
  requirePermission(NOTES, 'view'),
  validate({ params: idParam }),
  controller.getNoteHistory,
);

router.post(
  '/:id/amend',
  requirePermission(NOTES, 'amend'),
  validate({ params: idParam, body: amendNoteSchema }),
  audit({ action: 'amend', resourceType: 'ClinicalNote' }),
  controller.amendNote,
);

export default router;
