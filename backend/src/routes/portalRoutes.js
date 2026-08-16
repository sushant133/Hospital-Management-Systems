import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import { requirePortalAuth } from '../middleware/portalAuth.js';
import { invitePortalSchema, portalLoginSchema, portalBookSchema } from '../validators/tier23Validator.js';
import * as controller from '../controllers/portalController.js';

const router = Router();

router.post('/auth/login', validate({ body: portalLoginSchema }), controller.login);
router.post('/auth/logout', controller.logout);

router.get('/me', requirePortalAuth, controller.me);
router.get('/doctors', requirePortalAuth, controller.listDoctors);
router.get('/appointments', requirePortalAuth, controller.myAppointments);
router.get('/slots', requirePortalAuth, controller.mySlots);
router.post('/appointments', requirePortalAuth, validate({ body: portalBookSchema }), controller.bookAppointment);
router.get('/results', requirePortalAuth, controller.myResults);
router.get('/invoices', requirePortalAuth, controller.myInvoices);

export const staffPortalRouter = Router();
staffPortalRouter.use(requireAuth);
staffPortalRouter.post(
  '/:id/portal-invite',
  requirePermission(MODULES.PORTAL, 'invite'),
  validate({ params: idParam, body: invitePortalSchema }),
  controller.invite,
);

export default router;
