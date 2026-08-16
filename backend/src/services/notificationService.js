import { Notification } from '../models/index.js';
import config from '../config/env.js';

/**
 * Fan out an in-app notification (and an optional webhook that a hospital
 * can point at SMS / Slack / a pager gateway).
 *
 * Failures to deliver must never fail the clinical write that triggered them.
 */
export async function notify({
  userId,
  type,
  title,
  body = '',
  patientId = null,
  resourceType = '',
  resourceId = null,
}) {
  if (!userId) return null;

  let row = null;
  try {
    row = await Notification.create({
      userId,
      type,
      title,
      body,
      patientId,
      resourceType,
      resourceId,
      channel: config.notifyWebhookUrl ? 'both' : 'in-app',
    });
  } catch (error) {
    console.error('[notify] persist failed:', error.message);
    return null;
  }

  if (config.notifyWebhookUrl) {
    try {
      await fetch(config.notifyWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title,
          body,
          userId: String(userId),
          patientId: patientId ? String(patientId) : null,
          resourceType,
          resourceId: resourceId ? String(resourceId) : null,
        }),
      });
    } catch (error) {
      console.error('[notify] webhook failed:', error.message);
    }
  }

  return row;
}

export default notify;
