import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SMS_STATUSES = Object.freeze([
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'suppressed', // recipient opted out, or the number is unusable
]);

/**
 * The events a hospital actually sends SMS for. Named rather than free-text so
 * opt-out can be per-category — a patient who does not want marketing still
 * wants to know their report is ready.
 */
export const SMS_TEMPLATES = Object.freeze({
  APPOINTMENT_BOOKED: 'appointment-booked',
  APPOINTMENT_REMINDER: 'appointment-reminder',
  APPOINTMENT_CANCELLED: 'appointment-cancelled',
  LAB_RESULT_READY: 'lab-result-ready',
  RADIOLOGY_RESULT_READY: 'radiology-result-ready',
  INVOICE_ISSUED: 'invoice-issued',
  PAYMENT_RECEIVED: 'payment-received',
  ADMISSION_NOTICE: 'admission-notice',
  DISCHARGE_NOTICE: 'discharge-notice',
  ANC_VISIT_DUE: 'anc-visit-due',
  IMMUNISATION_DUE: 'immunisation-due',
  HIB_CEILING_LOW: 'hib-ceiling-low',
  OTP: 'otp',
});

/**
 * ============================================================================
 * ONE OUTBOUND SMS
 * ============================================================================
 *
 * Persisted rather than fired and forgotten, for three reasons that all cost
 * money or trust when ignored:
 *
 *   1. DELIVERY IS NOT GUARANTEED. Nepali gateways drop messages, and "did the
 *      patient get the reminder?" is a question the clinic asks daily.
 *   2. IT COSTS. A Devanagari message is billed at three segments where a Latin
 *      one is billed at one (see `segments` below), so an unwatched reminder
 *      campaign is a real line item.
 *   3. RETRY MUST BE SAFE. Connectivity drops constantly; the queue drains when
 *      it returns, and `dedupeKey` stops a retry sending the same reminder
 *      twice.
 */
const smsMessageSchema = new Schema(
  {
    /** E.164, as the gateway wants it. */
    to: { type: String, required: true, trim: true, index: true },

    template: { type: String, enum: Object.values(SMS_TEMPLATES), required: true, index: true },
    locale: { type: String, enum: ['ne', 'en'], default: 'ne' },
    body: { type: String, required: true },

    /**
     * GSM-7 vs UCS-2. A message containing any Devanagari character is encoded
     * UCS-2, where a segment is 70 characters instead of 160 — so the same
     * reminder costs roughly three times as much in Nepali as in English.
     * Computed on save so the cost report is honest.
     */
    encoding: { type: String, enum: ['gsm7', 'ucs2'], default: 'gsm7' },
    segments: { type: Number, default: 1, min: 1 },

    // Who and what it is about, so a message can be found from the chart.
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    resourceType: { type: String, trim: true, default: '' },
    resourceId: { type: Schema.Types.ObjectId, default: null },

    status: { type: String, enum: SMS_STATUSES, default: 'queued', index: true },

    provider: { type: String, trim: true, default: '' },
    /** The gateway's message id, for reconciling a delivery report. */
    providerMessageId: { type: String, trim: true, default: '', index: true },
    providerResponse: { type: Schema.Types.Mixed, default: null },

    attempts: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, default: '' },

    /** Don't send before this — how reminders are scheduled. */
    sendAfter: { type: Date, default: Date.now, index: true },

    /**
     * Idempotency. "Reminder for appointment X" is one message however many
     * times the scheduler runs, and a retry after a timeout must not double-send.
     */
    // Indexed below as a *partial unique* index — declaring `index: true` here
    // as well would build a second, plain copy of the same key.
    dedupeKey: { type: String, trim: true, default: '' },

    /** Estimated cost, so the monthly SMS spend is visible without the invoice. */
    estimatedCost: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    collection: 'smsMessages',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

// The queue drain: what is due, oldest first.
smsMessageSchema.index({ status: 1, sendAfter: 1 });
// Idempotency, but only for messages that actually carry a key.
smsMessageSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string', $ne: '' } } },
);

/** Devanagari (or any non-GSM-7 character) forces UCS-2 encoding. */
const GSM7_SAFE = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

smsMessageSchema.pre('save', function computeSegments(next) {
  if (this.isModified('body')) {
    const isGsm7 = GSM7_SAFE.test(this.body);
    this.encoding = isGsm7 ? 'gsm7' : 'ucs2';

    const single = isGsm7 ? 160 : 70;
    const concatenated = isGsm7 ? 153 : 67; // multipart messages lose header space
    const length = this.body.length;
    this.segments = length <= single ? 1 : Math.ceil(length / concatenated);
  }
  next();
});

export const SmsMessage = mongoose.model('SmsMessage', smsMessageSchema);
export default SmsMessage;
