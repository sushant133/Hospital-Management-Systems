import { z } from 'zod';
import { extendListQuery } from '../utils/commonSchemas.js';
import { NOTIFICATION_TYPES } from '../models/Notification.js';

export const listNotificationsQuery = extendListQuery({
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});
