import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { codeableConcept } from './CodeSystem.js';

const { Schema } = mongoose;

export const PROBLEM_STATUSES = Object.freeze(['active', 'resolved', 'inactive', 'entered-in-error']);
export const PROBLEM_SEVERITIES = Object.freeze(['mild', 'moderate', 'severe']);

/**
 * ============================================================================
 * THE PROBLEM LIST
 * ============================================================================
 *
 * A longitudinal, coded list of what is wrong with this patient — as opposed to
 * `Encounter.diagnosis`, which is what was wrong at one visit.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DISTINCTION MATTERS
 * ---------------------------------------------------------------------------
 * Without a problem list, a chronic condition recorded in one encounter is
 * invisible in the next unless somebody reads the whole timeline — which nobody
 * does in a 400-patient OPD day. The diabetic who arrives with a foot ulcer is
 * treated for the ulcer, and the diabetes is rediscovered later, or not.
 *
 * So: a diagnosis is an event, a problem persists. `onsetEncounterId` records
 * where a problem was first noticed without tying its lifetime to that visit.
 *
 * ---------------------------------------------------------------------------
 * RESOLVED IS NOT DELETED
 * ---------------------------------------------------------------------------
 * A resolved problem stays on the list with its dates. "Had TB in 2019,
 * completed treatment" is clinically vital and disappears entirely if
 * resolution means removal. `entered-in-error` is the only route to making
 * something invisible, and it is a separate, audited state.
 */
const problemSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    /**
     * Coded where possible. Free text is permitted because a problem is often
     * recognised before it is codable ("recurrent abdominal pain, cause
     * unclear"), and refusing to record it would push it back into a note where
     * nothing can see it.
     */
    concept: { type: codeableConcept({ required: false }), default: null },
    display: { type: String, required: true, trim: true },

    status: { type: String, enum: PROBLEM_STATUSES, default: 'active', index: true },
    severity: { type: String, enum: [...PROBLEM_SEVERITIES, ''], default: '' },

    /** True for conditions the patient will have indefinitely. */
    isChronic: { type: Boolean, default: false, index: true },

    onsetDate: { type: Date, default: null },
    onsetEncounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    recordedAt: { type: Date, default: Date.now },

    resolvedDate: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolutionNote: { type: String, trim: true, default: '' },

    /** Surfaced at the top of every encounter regardless of specialty. */
    isPriority: { type: Boolean, default: false, index: true },

    notes: { type: String, trim: true, default: '' },

    erroneousReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'problems',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

problemSchema.plugin(auditable);

/** The list as it opens on every encounter: active problems, priority first. */
problemSchema.index({ patientId: 1, status: 1, isPriority: -1, recordedAt: -1 });
problemSchema.index({ 'concept.code': 1, status: 1 });

/** Resolution needs a date; without one the list cannot be read chronologically. */
problemSchema.path('resolvedDate').validate(function requireDate(value) {
  return this.status !== 'resolved' || Boolean(value);
}, 'A resolved problem needs the date it resolved.');

problemSchema.path('erroneousReason').validate(function requireReason(value) {
  return this.status !== 'entered-in-error' || (value && value.trim().length >= 5);
}, 'Marking a problem entered-in-error needs a stated reason.');

export const Problem = mongoose.model('Problem', problemSchema);

/* ==========================================================================
 * CARE PLANS
 * ======================================================================= */

export const CARE_PLAN_STATUSES = Object.freeze(['draft', 'active', 'completed', 'cancelled']);
export const GOAL_STATUSES = Object.freeze(['not-started', 'in-progress', 'achieved', 'not-achieved']);

/**
 * A nursing or multidisciplinary care plan: goals, and the interventions meant
 * to reach them.
 *
 * Tied to problems rather than free-standing, so "why are we doing this" is
 * always answerable — an intervention with no problem behind it is either
 * unnecessary or evidence that the problem list is incomplete.
 */
const carePlanSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null, index: true },
    problemIds: { type: [Schema.Types.ObjectId], ref: 'Problem', default: [] },

    title: { type: String, required: true, trim: true },
    status: { type: String, enum: CARE_PLAN_STATUSES, default: 'draft', index: true },

    goals: {
      type: [
        new Schema(
          {
            description: { type: String, required: true, trim: true },
            targetDate: { type: Date, default: null },
            status: { type: String, enum: GOAL_STATUSES, default: 'not-started' },
            /** How the goal will be judged met — vague goals are never met. */
            measure: { type: String, trim: true, default: '' },
            reviewedAt: { type: Date, default: null },
            reviewNote: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    interventions: {
      type: [
        new Schema(
          {
            description: { type: String, required: true, trim: true },
            frequency: { type: String, trim: true, default: '' },
            assignedRole: { type: String, trim: true, default: '' },
            active: { type: Boolean, default: true },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    startedAt: { type: Date, default: Date.now },
    /** Care plans go stale; a review date keeps them from becoming wallpaper. */
    reviewDue: { type: Date, default: null, index: true },
    lastReviewedAt: { type: Date, default: null },
    lastReviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    completedAt: { type: Date, default: null },
    createdByRole: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'carePlans',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

carePlanSchema.plugin(auditable);
carePlanSchema.index({ patientId: 1, status: 1 });
carePlanSchema.index({ status: 1, reviewDue: 1 });

carePlanSchema.virtual('isReviewOverdue').get(function overdue() {
  if (this.status !== 'active' || !this.reviewDue) return false;
  return new Date(this.reviewDue) < new Date();
});

export const CarePlan = mongoose.model('CarePlan', carePlanSchema);

/* ==========================================================================
 * NOTE TEMPLATES
 * ======================================================================= */

/**
 * Per-specialty note skeletons.
 *
 * Not cosmetic: a template is how a department encodes what it always wants
 * asked. An obstetric admission note that prompts for gestation and fetal
 * movements gets them recorded; a blank SOAP box does not.
 */
const noteTemplateSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    nameNe: { type: String, trim: true, default: '' },

    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    noteType: { type: String, trim: true, default: 'soap' },

    sections: {
      type: [
        new Schema(
          {
            key: { type: String, required: true, trim: true },
            label: { type: String, required: true, trim: true },
            labelNe: { type: String, trim: true, default: '' },
            /** Pre-filled prompt text the clinician edits over. */
            placeholder: { type: String, trim: true, default: '' },
            required: { type: Boolean, default: false },
            order: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** A discharge-summary template drives the generated document. */
    isDischargeSummary: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: 'noteTemplates',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

noteTemplateSchema.plugin(auditable);
noteTemplateSchema.index({ departmentId: 1, isActive: 1 });

export const NoteTemplate = mongoose.model('NoteTemplate', noteTemplateSchema);

export default { Problem, CarePlan, NoteTemplate };
