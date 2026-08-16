import { SmsMessage } from '../models/index.js';
import { SMS_TEMPLATES } from '../models/SmsMessage.js';
import config from '../config/env.js';
import { toE164, isValidNepaliPhone, formatNpr, formatAdAsBs } from '../utils/nepal.js';

/**
 * ============================================================================
 * SMS — THE CHANNEL THAT ACTUALLY WORKS IN NEPAL
 * ============================================================================
 *
 * Email is barely used by patients and smartphone penetration is uneven outside
 * the Valley, so SMS is how a hospital reaches a family: appointment reminders,
 * "your report is ready", admission notices, payment confirmations.
 *
 * ---------------------------------------------------------------------------
 * QUEUED, NEVER SENT INLINE
 * ---------------------------------------------------------------------------
 * `queue()` writes a row and returns. It never awaits the gateway, and it never
 * throws into its caller. A clinical write must not fail — or even slow down —
 * because an SMS provider is having a bad afternoon, and in a hospital with
 * intermittent connectivity that is a routine afternoon.
 *
 * The queue is drained by a job (jobs/smsQueueJob.js). That also gives retry,
 * delivery tracking and a cost trail for free.
 */

/* ==========================================================================
 * TEMPLATES
 * ==========================================================================
 * Nepali is the default. Every template is written to fit inside as few SMS
 * segments as possible: a Devanagari message is UCS-2, where a segment is 70
 * characters rather than 160, so a chatty Nepali reminder costs three times
 * what a terse one does. Brevity here is money.
 */
const TEMPLATES = {
  [SMS_TEMPLATES.APPOINTMENT_BOOKED]: {
    ne: ({ hospital, doctor, dateBs, time }) =>
      `${hospital}: ${doctor} सँग ${dateBs} ${time} बजे अपोइन्टमेन्ट बुक भयो।`,
    en: ({ hospital, doctor, dateBs, time }) =>
      `${hospital}: Appointment with ${doctor} booked for ${dateBs} at ${time}.`,
  },
  [SMS_TEMPLATES.APPOINTMENT_REMINDER]: {
    ne: ({ hospital, dateBs, time }) => `${hospital}: भोलि ${dateBs} ${time} बजे तपाईंको अपोइन्टमेन्ट छ।`,
    en: ({ hospital, dateBs, time }) => `${hospital}: Reminder — your appointment is ${dateBs} at ${time}.`,
  },
  [SMS_TEMPLATES.APPOINTMENT_CANCELLED]: {
    ne: ({ hospital, dateBs }) => `${hospital}: ${dateBs} को अपोइन्टमेन्ट रद्द भयो।`,
    en: ({ hospital, dateBs }) => `${hospital}: Your appointment on ${dateBs} has been cancelled.`,
  },
  [SMS_TEMPLATES.LAB_RESULT_READY]: {
    ne: ({ hospital }) => `${hospital}: तपाईंको ल्याब रिपोर्ट तयार छ। कृपया सम्पर्क गर्नुहोस्।`,
    en: ({ hospital }) => `${hospital}: Your lab report is ready for collection.`,
  },
  [SMS_TEMPLATES.RADIOLOGY_RESULT_READY]: {
    ne: ({ hospital }) => `${hospital}: तपाईंको एक्स-रे/स्क्यान रिपोर्ट तयार छ।`,
    en: ({ hospital }) => `${hospital}: Your imaging report is ready.`,
  },
  [SMS_TEMPLATES.INVOICE_ISSUED]: {
    ne: ({ hospital, amount, invoiceNumber }) =>
      `${hospital}: बिल नं ${invoiceNumber}, रकम ${amount}। भुक्तानीका लागि सम्पर्क गर्नुहोस्।`,
    en: ({ hospital, amount, invoiceNumber }) =>
      `${hospital}: Invoice ${invoiceNumber} for ${amount} is ready.`,
  },
  [SMS_TEMPLATES.PAYMENT_RECEIVED]: {
    ne: ({ hospital, amount }) => `${hospital}: ${amount} भुक्तानी प्राप्त भयो। धन्यवाद।`,
    en: ({ hospital, amount }) => `${hospital}: Payment of ${amount} received. Thank you.`,
  },
  [SMS_TEMPLATES.ADMISSION_NOTICE]: {
    ne: ({ hospital, patientName, ward }) =>
      `${hospital}: ${patientName} लाई ${ward} मा भर्ना गरिएको छ।`,
    en: ({ hospital, patientName, ward }) =>
      `${hospital}: ${patientName} has been admitted to ${ward}.`,
  },
  [SMS_TEMPLATES.DISCHARGE_NOTICE]: {
    ne: ({ hospital, patientName }) => `${hospital}: ${patientName} डिस्चार्ज हुनुभयो।`,
    en: ({ hospital, patientName }) => `${hospital}: ${patientName} has been discharged.`,
  },
  [SMS_TEMPLATES.ANC_VISIT_DUE]: {
    ne: ({ hospital, dateBs }) => `${hospital}: ${dateBs} मा गर्भवती जाँचको समय भएको छ।`,
    en: ({ hospital, dateBs }) => `${hospital}: Your antenatal check is due on ${dateBs}.`,
  },
  [SMS_TEMPLATES.IMMUNISATION_DUE]: {
    ne: ({ hospital, dateBs }) => `${hospital}: ${dateBs} मा बच्चाको खोपको समय भएको छ।`,
    en: ({ hospital, dateBs }) => `${hospital}: Your child's immunisation is due on ${dateBs}.`,
  },
  [SMS_TEMPLATES.HIB_CEILING_LOW]: {
    ne: ({ hospital, remaining }) =>
      `${hospital}: स्वास्थ्य बीमाको बाँकी रकम ${remaining} मात्र छ।`,
    en: ({ hospital, remaining }) =>
      `${hospital}: Your health insurance has ${remaining} of cover remaining.`,
  },
  [SMS_TEMPLATES.OTP]: {
    ne: ({ code }) => `तपाईंको कोड: ${code}। कसैलाई नबताउनुहोस्।`,
    en: ({ code }) => `Your code is ${code}. Do not share it with anyone.`,
  },
};

/** Render a template, falling back to English if a Nepali variant is missing. */
export function render(template, locale, values) {
  const set = TEMPLATES[template];
  if (!set) throw new Error(`No SMS template named "${template}".`);
  const fn = set[locale] || set.en;
  return fn(values);
}

/**
 * Values every template can rely on, so callers pass only what is specific to
 * their event. Dates arrive as Gregorian instants and leave as BS strings —
 * a patient reading "16 July" has to translate it themselves.
 */
function baseValues(extra = {}) {
  const values = { hospital: config.hospital.name, ...extra };
  if (extra.date) {
    values.dateBs = formatAdAsBs(extra.date, { locale: extra.locale || 'ne' });
  }
  if (extra.amountValue !== undefined) {
    values.amount = formatNpr(extra.amountValue, { locale: extra.locale || 'ne' });
  }
  if (extra.remainingValue !== undefined) {
    values.remaining = formatNpr(extra.remainingValue, { locale: extra.locale || 'ne' });
  }
  return values;
}

/**
 * Queue one SMS.
 *
 * Returns the queued row, or null when there is nothing sendable — an unusable
 * number, or a duplicate of something already queued. Never throws: the caller
 * is in the middle of admitting a patient or issuing a bill, and a messaging
 * problem must not become a clinical or financial one.
 */
export async function queue({
  to,
  template,
  locale = 'ne',
  values = {},
  patientId = null,
  userId = null,
  resourceType = '',
  resourceId = null,
  sendAfter = new Date(),
  dedupeKey = '',
}) {
  try {
    if (!isValidNepaliPhone(to)) {
      // Not an error worth raising — plenty of patients give a landline or an
      // incomplete number, and the clinical write must proceed regardless.
      return null;
    }

    const body = render(template, locale, baseValues({ ...values, locale }));

    const message = await SmsMessage.create({
      to: toE164(to),
      template,
      locale,
      body,
      patientId,
      userId,
      resourceType,
      resourceId,
      sendAfter,
      dedupeKey,
      status: config.sms.enabled ? 'queued' : 'suppressed',
      failureReason: config.sms.enabled ? '' : 'SMS is disabled in this environment.',
    });

    return message;
  } catch (error) {
    // A duplicate key means the same message is already queued — that is the
    // dedupe working, not a failure.
    if (error?.code === 11000) return null;
    console.error('[sms] queue failed:', error.message);
    return null;
  }
}

/* ==========================================================================
 * PROVIDER ADAPTERS
 * ==========================================================================
 * One interface, several Nepali gateways. Sparrow SMS and Aakash SMS are the
 * two most hospitals already hold an account with; both are simple HTTP APIs
 * with an auth token, a sender identity and a recipient list.
 *
 * Each adapter returns `{ ok, providerMessageId, response }` and never throws —
 * the caller (the queue drain) decides about retries.
 */

const adapters = {
  /** Sparrow SMS — https://sparrowsms.com */
  async sparrow({ to, body }) {
    const params = new URLSearchParams({
      token: config.sms.token,
      from: config.sms.senderId,
      // Sparrow wants the national number without the country code.
      to: to.replace(/^\+977/, ''),
      text: body,
    });

    const response = await fetch(`${config.sms.baseUrl}?${params}`, { method: 'GET' });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload?.response_code === 200,
      providerMessageId: payload?.message_id ? String(payload.message_id) : '',
      response: payload,
    };
  },

  /** Aakash SMS — https://aakashsms.com */
  async aakash({ to, body }) {
    const response = await fetch(config.sms.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: config.sms.token,
        to: to.replace(/^\+977/, ''),
        text: body,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload?.error === false,
      providerMessageId: payload?.data?.message_id ? String(payload.data.message_id) : '',
      response: payload,
    };
  },

  /**
   * Generic webhook — the escape hatch that already existed. A hospital points
   * it at whatever gateway, pager or Slack bridge they run.
   */
  async webhook({ to, body, message }) {
    const response = await fetch(config.sms.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body, template: message.template }),
    });
    return { ok: response.ok, providerMessageId: '', response: { status: response.status } };
  },
};

/** Send one queued message. Used by the drain job; not called directly. */
export async function deliver(message) {
  const adapter = adapters[config.sms.provider];
  if (!adapter) {
    return { ok: false, error: `No SMS adapter named "${config.sms.provider}".` };
  }

  try {
    const result = await adapter({ to: message.to, body: message.body, message });
    return result;
  } catch (error) {
    return { ok: false, error: error.message, response: null };
  }
}

export { SMS_TEMPLATES };

export default { queue, deliver, render, SMS_TEMPLATES };
