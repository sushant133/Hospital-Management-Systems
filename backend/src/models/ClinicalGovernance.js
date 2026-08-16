import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * CLINICAL GOVERNANCE (B11)
 * ============================================================================
 *
 * Incidents, mortality review, and complaints — the three things that turn an
 * HMS into a quality system, and the three an accreditation visit asks for
 * first.
 */

/* ==========================================================================
 * INCIDENT REPORTING
 * ======================================================================= */

export const INCIDENT_CATEGORIES = Object.freeze([
  'medication-error',
  'near-miss',
  'patient-fall',
  'pressure-ulcer',
  'wrong-patient',
  'wrong-site-procedure',
  'specimen-error',
  'transfusion-error',
  'equipment-failure',
  'documentation-error',
  'delay-in-care',
  'hospital-acquired-infection',
  'violence-against-staff',
  'needlestick',
  'absconding',
  'other',
]);

/**
 * Harm actually reached, on the standard scale.
 *
 * `no-harm` and `near-miss` are the ones worth collecting most: they are far
 * commoner, carry the same lessons, and cost nothing to have happened. A
 * reporting system that only hears about harm has already missed its chance.
 */
export const HARM_LEVELS = Object.freeze([
  'near-miss', // never reached the patient
  'no-harm', // reached them, no injury
  'minor',
  'moderate',
  'severe',
  'death',
]);

export const INCIDENT_STATUSES = Object.freeze([
  'reported',
  'triaged',
  'investigating',
  'actions-agreed',
  'closed',
]);

const incidentReportSchema = new Schema(
  {
    incidentNumber: { type: String, unique: true, index: true },

    category: { type: String, enum: INCIDENT_CATEGORIES, required: true, index: true },
    harmLevel: { type: String, enum: HARM_LEVELS, required: true, index: true },

    occurredAt: { type: Date, required: true, index: true },
    discoveredAt: { type: Date, default: Date.now },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },

    /** What happened, in the reporter's own words. */
    description: { type: String, required: true, trim: true },
    immediateAction: { type: String, trim: true, default: '' },

    /**
     * ---------------------------------------------------------------------
     * ANONYMOUS REPORTING IS SUPPORTED, AND IT MATTERS
     * ---------------------------------------------------------------------
     * Staff do not report incidents they fear being blamed for, and the
     * incidents most worth learning from are exactly the ones someone made a
     * mistake in. Allowing an anonymous report trades a little
     * follow-up-ability for a great deal more signal.
     *
     * `reportedBy` is therefore nullable, and the UI must not quietly require it.
     */
    isAnonymous: { type: Boolean, default: false },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    reportedAt: { type: Date, default: Date.now, index: true },

    status: { type: String, enum: INCIDENT_STATUSES, default: 'reported', index: true },

    // --- Investigation ------------------------------------------------------
    severityScore: { type: Number, default: null, min: 1, max: 25 },
    investigatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    investigationStartedAt: { type: Date, default: null },

    /**
     * Contributing factors, not "who did it".
     *
     * A root-cause analysis that terminates at a person's name has stopped one
     * step early — the question is what let a competent person make that
     * mistake. The categories steer the investigation toward the system.
     */
    contributingFactors: {
      type: [
        new Schema(
          {
            factor: {
              type: String,
              enum: [
                'staffing',
                'workload',
                'training',
                'communication',
                'equipment',
                'medication-labelling',
                'protocol-absent',
                'protocol-not-followed',
                'environment',
                'patient-factors',
                'other',
              ],
              required: true,
            },
            note: { type: String, trim: true, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    rootCause: { type: String, trim: true, default: '' },

    /** Corrective actions, each owned by somebody with a date. */
    actions: {
      type: [
        new Schema(
          {
            description: { type: String, required: true, trim: true },
            ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            dueDate: { type: Date, default: null },
            completedAt: { type: Date, default: null },
            completionNote: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lessonsLearned: { type: String, trim: true, default: '' },
    /** Shared as a teaching case, with identifiers removed. */
    sharedForLearning: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'incidentReports',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

incidentReportSchema.plugin(auditable);
incidentReportSchema.index({ status: 1, harmLevel: 1, occurredAt: -1 });
incidentReportSchema.index({ category: 1, occurredAt: -1 });
incidentReportSchema.index({ wardId: 1, occurredAt: -1 });

incidentReportSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.incidentNumber) {
    this.incidentNumber = await nextFormattedId('incident', 'INC', 6);
  }
  next();
});

/**
 * An anonymous report must not carry a reporter.
 *
 * Storing the id "just in case" while showing the reporter an anonymity promise
 * would be a lie the database keeps — and the first time it was noticed,
 * reporting would stop entirely.
 */
incidentReportSchema.pre('save', function enforceAnonymity(next) {
  if (this.isAnonymous) this.reportedBy = null;
  next();
});

/** Actions agreed but overdue — what a governance meeting actually reviews. */
incidentReportSchema.virtual('overdueActions').get(function overdue() {
  const now = new Date();
  return (this.actions || []).filter((a) => !a.completedAt && a.dueDate && new Date(a.dueDate) < now);
});

export const IncidentReport = mongoose.model('IncidentReport', incidentReportSchema);

/* ==========================================================================
 * MORTALITY AND MORBIDITY REVIEW
 * ======================================================================= */

export const MM_VERDICTS = Object.freeze([
  'unavoidable',
  'possibly-avoidable',
  'probably-avoidable',
  'avoidable',
  'undetermined',
]);

const mortalityReviewSchema = new Schema(
  {
    reviewNumber: { type: String, unique: true, index: true },

    deathRecordId: { type: Schema.Types.ObjectId, ref: 'DeathRecord', default: null, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },

    /** Why this case came to review — the 48-hour rule, theatre, maternal… */
    trigger: { type: String, trim: true, default: '' },

    scheduledFor: { type: Date, default: null, index: true },
    heldAt: { type: Date, default: null },
    chairedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    attendees: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },

    caseSummary: { type: String, trim: true, default: '' },
    /** Points in the pathway where a different decision was available. */
    careIssuesIdentified: { type: [String], default: [] },
    verdict: { type: String, enum: [...MM_VERDICTS, ''], default: '' },
    verdictRationale: { type: String, trim: true, default: '' },

    /** Reviews that change nothing are theatre; actions make them real. */
    actions: {
      type: [
        new Schema(
          {
            description: { type: String, required: true, trim: true },
            ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            dueDate: { type: Date, default: null },
            completedAt: { type: Date, default: null },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    incidentReportId: { type: Schema.Types.ObjectId, ref: 'IncidentReport', default: null },
    closedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'mortalityReviews',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

mortalityReviewSchema.plugin(auditable);
mortalityReviewSchema.index({ closedAt: 1, scheduledFor: 1 });

mortalityReviewSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.reviewNumber) {
    this.reviewNumber = await nextFormattedId('mortalityReview', 'MMR', 5);
  }
  next();
});

export const MortalityReview = mongoose.model('MortalityReview', mortalityReviewSchema);

/* ==========================================================================
 * COMPLAINTS AND FEEDBACK
 * ======================================================================= */

export const COMPLAINT_CATEGORIES = Object.freeze([
  'clinical-care',
  'staff-attitude',
  'waiting-time',
  'billing',
  'cleanliness',
  'food',
  'facilities',
  'communication',
  'privacy',
  'compliment',
  'other',
]);

export const COMPLAINT_STATUSES = Object.freeze([
  'received',
  'acknowledged',
  'investigating',
  'resolved',
  'escalated',
  'withdrawn',
]);

const complaintSchema = new Schema(
  {
    complaintNumber: { type: String, unique: true, index: true },

    category: { type: String, enum: COMPLAINT_CATEGORIES, required: true, index: true },
    /** Compliments go in the same register: the ratio is itself the measure. */
    isCompliment: { type: Boolean, default: false, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },

    /** Often a relative rather than the patient. */
    complainantName: { type: String, trim: true, default: '' },
    complainantRelation: { type: String, trim: true, default: '' },
    complainantContact: { type: String, trim: true, default: '' },
    isAnonymous: { type: Boolean, default: false },

    receivedAt: { type: Date, default: Date.now, index: true },
    receivedVia: {
      type: String,
      enum: ['in-person', 'phone', 'letter', 'suggestion-box', 'portal', 'sms', 'other'],
      default: 'in-person',
    },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    description: { type: String, required: true, trim: true },

    status: { type: String, enum: COMPLAINT_STATUSES, default: 'received', index: true },

    /** Acknowledging quickly is most of what a complainant wants. */
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Service standard for a response, set on receipt. */
    responseDueBy: { type: Date, default: null, index: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    investigationNotes: { type: String, trim: true, default: '' },

    /**
     * Closing the loop. A complaint resolved without the complainant being told
     * has not been resolved from the only perspective that counts.
     */
    resolution: { type: String, trim: true, default: '' },
    resolvedAt: { type: Date, default: null },
    complainantInformedAt: { type: Date, default: null },
    complainantSatisfied: { type: Boolean, default: null },

    /** A complaint that reveals a safety issue becomes an incident too. */
    incidentReportId: { type: Schema.Types.ObjectId, ref: 'IncidentReport', default: null },
  },
  {
    timestamps: true,
    collection: 'complaints',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

complaintSchema.plugin(auditable);
complaintSchema.index({ status: 1, responseDueBy: 1 });
complaintSchema.index({ category: 1, receivedAt: -1 });

complaintSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.complaintNumber) {
    this.complaintNumber = await nextFormattedId('complaint', 'CMP', 6);
  }
  next();
});

complaintSchema.virtual('isOverdue').get(function overdue() {
  if (!this.responseDueBy || this.resolvedAt) return false;
  return new Date(this.responseDueBy) < new Date();
});

export const Complaint = mongoose.model('Complaint', complaintSchema);

export default { IncidentReport, MortalityReview, Complaint };
