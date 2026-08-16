import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const ALERT_SOURCES = Object.freeze(['lab', 'radiology', 'vitals', 'manual']);

export const ALERT_STATUSES = Object.freeze([
  'open', // raised, nobody has seen it
  'notified', // the clinician has been paged
  'acknowledged', // a named clinician has seen it
  'actioned', // something was done, and recorded
  'escalated', // nobody acknowledged in time
  'cancelled', // raised in error, e.g. an amended result
]);

/**
 * Escalation ladder. Each rung is tried in turn if the previous does not
 * acknowledge inside its window.
 */
export const ESCALATION_LEVELS = Object.freeze([
  'ordering-clinician',
  'covering-clinician',
  'consultant',
  'duty-officer',
]);

/**
 * ============================================================================
 * A CRITICAL RESULT NOBODY HAS ACKNOWLEDGED YET
 * ============================================================================
 *
 * A critical potassium of 7.2 that sits unread in a worklist is the single most
 * common route to preventable death in a hospital, and the classic malpractice
 * case. The lab already flags the value; what was missing is the half that
 * matters — did a human being actually see it, and when?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE COLLECTION
 * ---------------------------------------------------------------------------
 * It could have been three fields on `LabResult`. It is not, for three reasons:
 *
 *   1. Radiology criticals need the identical loop, and duplicating it would
 *      guarantee the two drift apart.
 *   2. The escalation ladder is a state machine with its own history — who was
 *      paged, when, and what happened. That does not belong bolted onto a
 *      result document whose job is to hold values.
 *   3. "Show me every unacknowledged critical in the hospital right now" is the
 *      question a regulator and a duty officer both ask, and it must be one
 *      indexed query, not a scan across two result collections.
 *
 * ---------------------------------------------------------------------------
 * ACKNOWLEDGEMENT IS NOT THE SAME AS ACTION
 * ---------------------------------------------------------------------------
 * Deliberately two states. A clinician seeing the result closes the safety
 * loop on communication; it does not mean the patient was treated. Collapsing
 * them would let a glance count as care, which is precisely the failure the
 * whole mechanism exists to prevent.
 */
const notificationAttemptSchema = new Schema(
  {
    level: { type: String, enum: ESCALATION_LEVELS, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Denormalised so the trail survives a staff record being deactivated. */
    userName: { type: String, trim: true, default: '' },
    channel: { type: String, enum: ['in-app', 'sms', 'webhook', 'phone', 'in-person'], required: true },
    sentAt: { type: Date, default: Date.now },
    delivered: { type: Boolean, default: false },
    /** Free text for a phone call or a bedside conversation. */
    note: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

const criticalAlertSchema = new Schema(
  {
    alertNumber: { type: String, unique: true, index: true },

    source: { type: String, enum: ALERT_SOURCES, required: true, index: true },
    /** The result that triggered this. Polymorphic across lab and radiology. */
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    sourceRef: { type: String, trim: true, default: '' },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null, index: true },

    /** What is critical, in the words that go on a page or an SMS. */
    summary: { type: String, required: true, trim: true },
    /** The individual out-of-range values, for the alert detail view. */
    findings: {
      type: [
        new Schema(
          {
            analyte: { type: String, trim: true, required: true },
            value: { type: String, trim: true, required: true },
            unit: { type: String, trim: true, default: '' },
            flag: { type: String, trim: true, default: '' },
            criticalLow: { type: Number, default: null },
            criticalHigh: { type: Number, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    status: { type: String, enum: ALERT_STATUSES, default: 'open', index: true },

    /** Who should see this first — normally whoever ordered the test. */
    orderingClinicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    raisedAt: { type: Date, default: Date.now, index: true },

    // --- The communication loop -------------------------------------------
    notifications: { type: [notificationAttemptSchema], default: [] },

    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedAt: { type: Date, default: null, index: true },
    /**
     * How the result was received. A read-back is the safety standard for a
     * verbally communicated critical value, so it is recorded rather than
     * assumed.
     */
    acknowledgementChannel: {
      type: String,
      enum: ['in-app', 'phone-readback', 'in-person', ''],
      default: '',
    },

    actionedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actionedAt: { type: Date, default: null },
    /** What was actually done. The line a coroner reads. */
    actionTaken: { type: String, trim: true, default: '' },

    // --- Escalation --------------------------------------------------------
    escalationLevel: { type: Number, default: 0, min: 0 },
    /** When the current rung stops waiting and the next is paged. */
    escalateAfter: { type: Date, default: null, index: true },
    escalatedAt: { type: Date, default: null },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'criticalAlerts',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

criticalAlertSchema.plugin(auditable);

/**
 * The board a duty officer and a regulator both ask for: everything still
 * unacknowledged, oldest first.
 */
criticalAlertSchema.index({ status: 1, raisedAt: 1 });
/** The escalation sweep — due rungs, cheapest possible query. */
criticalAlertSchema.index({ status: 1, escalateAfter: 1 });
criticalAlertSchema.index({ patientId: 1, raisedAt: -1 });
/** One live alert per result: an amended result must not raise a duplicate. */
criticalAlertSchema.index(
  { source: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['open', 'notified', 'escalated'] } } },
);

criticalAlertSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.alertNumber) {
    this.alertNumber = await nextFormattedId('criticalAlert', 'CRIT', 6);
  }
  next();
});

/** Minutes since the result was flagged and nobody acknowledged. */
criticalAlertSchema.virtual('minutesOutstanding').get(function minutes() {
  if (this.acknowledgedAt) return null;
  return Math.floor((Date.now() - new Date(this.raisedAt)) / 60000);
});

/** Still open and past its escalation window. */
criticalAlertSchema.virtual('isOverdue').get(function overdue() {
  if (!this.escalateAfter || this.acknowledgedAt) return false;
  return new Date(this.escalateAfter) < new Date();
});

export const CriticalAlert = mongoose.model('CriticalAlert', criticalAlertSchema);
export default CriticalAlert;
