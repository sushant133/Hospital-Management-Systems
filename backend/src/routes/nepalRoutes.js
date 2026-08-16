import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { localLevelQuery, convertDateQuery } from '../validators/nepalValidator.js';
import * as controller from '../controllers/nepalController.js';

/**
 * Nepal reference data: administrative geography, identity document types, and
 * calendar conversion.
 *
 * Read-only and granted to every signed-in role — an address form and a date
 * field are needed by everyone, and there is nothing restrictable about the
 * list of districts. No `audit()` middleware anywhere here for the same reason:
 * these are reads of public reference data, and logging them would bury the
 * write trail that matters.
 */
const router = Router();
router.use(requireAuth);

const canView = requirePermission(MODULES.NEPAL_REFERENCE, 'view');

router.get('/divisions', canView, controller.getAdministrativeDivisions);
router.get('/provinces/:provinceCode/districts', canView, controller.getDistrictsForProvince);
router.get('/local-levels', canView, validate({ query: localLevelQuery }), controller.getLocalLevels);
router.get('/identifier-types', canView, controller.getIdentifierTypes);

router.get('/calendar', canView, controller.getCalendarContext);
router.get('/calendar/convert', canView, validate({ query: convertDateQuery }), controller.convertDate);
router.get('/fiscal-years', canView, controller.getFiscalYears);

export default router;
