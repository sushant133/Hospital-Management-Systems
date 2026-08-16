import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import { listNotificationsQuery } from '../validators/notificationValidator.js';
import * as controller from '../controllers/notificationController.js';

const router = Router();
router.use(requireAuth);

const N = MODULES.NOTIFICATIONS;

router.get(
  '/',
  requirePermission(N, 'viewOwn'),
  validate({ query: listNotificationsQuery }),
  controller.listNotifications,
);

router.get(
  '/unread-count',
  requirePermission(N, 'viewOwn'),
  controller.unreadCount,
);

router.post(
  '/read-all',
  requirePermission(N, 'viewOwn'),
  controller.markAllRead,
);

router.post(
  '/:id/read',
  requirePermission(N, 'viewOwn'),
  validate({ params: idParam }),
  controller.markRead,
);

export default router;
