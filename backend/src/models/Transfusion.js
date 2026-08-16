import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const TRANSFUSION_STATUSES = Object.freeze([
  'prepared', // unit issued from the bank, not yet started
  'in-progress',
  'completed',
  'stopped', // halted, usually because of a reaction
  'discarded', // never given
]);

export const REACTION_TYPES = Object.freeze([
  'febrile-non-haemolytic',
  'acute-haemolytic',
  'delayed-haemolytic',
  'allergic-minor',
  'anaphylactic',
  'trali', // transfusion-related acute lung injury
  'taco', // transfusion-associated circulatory overload
  'bacterial-contamination',
  'hypotensive',
  'other',
]);

export const REACTION_SEVERITIES = Object.freeze(['mild', 'moderate', 'severe', 'life-threatening', 'death']);

/**
 * ============================================================================
 * TRANSFUSION ADMINISTRATION AND HAEMOVIGILANCE (B10)
 * ============================================================================
 *
 * The blood bank already tracked units and requests. That is the easy half.
 * This is the half where patients are actually harmed: the bedside check, the
 * observations during the transfusion, and what happens when it goes wrong.
 *
 * ---------------------------------------------------------------------------
 * THE BEDSIDE CHECK IS THE LAST BARRIER
 * ---------------------------------------------------------------------------
 * Almost every fatal haemolytic reaction is an ABO-incompatible unit given to
 * the wrong patient, and almost every one of those passed a correct laboratory
 * cross-match. The failure is at the bedside — the right unit, the wrong bed.
 *
 * Hence: two named people, recorded independently, checking patient identity
 * against the unit label. The model refuses a transfusion that claims one
 * person did both checks, because a self-witnessed check is not a check.
 *
 * ---------------------------------------------------------------------------
 * OBSERVATIONS ARE TIMED, NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * A severe reaction usually declares itself in the first fifteen minutes. The
 * observation schedule exists so that window is watched rather than assumed,
 * and `observations` is a series rather than a single "obs done" flag.
 */
const observationSchema = new Schema(
  {
    /** Minutes from the start: 0, 15, 30, then hourly. */
    atMinutes: { type: Number, required: true, min: 0 },
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    temperature: { type: Number, default: null },
    pulse: { type: Number, default: null },
    systolic: { type: Number, default: null },
    diastolic: { type: Number, default: null },
    respiratoryRate: { type: Number, default: null },
    oxygenSaturation: { type: Number, default: null },
    note: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

const transfusionSchema = new Schema(
  {
    transfusionNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    bloodRequestId: { type: Schema.Types.ObjectId, ref: 'BloodRequest', default: null },
    bloodUnitId: { type: Schema.Types.ObjectId, ref: 'BloodUnit', required: true, index: true },

    /** Snapshots, so the record still reads correctly if a unit row changes. */
    bagNumber: { type: String, required: true, trim: true },
    component: { type: String, required: true, trim: true },
    unitBloodGroup: { type: String, required: true, trim: true },
    patientBloodGroup: { type: String, required: true, trim: true },

    status: { type: String, enum: TRANSFUSION_STATUSES, default: 'prepared', index: true },

    // --- The bedside check --------------------------------------------------
    /**
     * Two independent people. Both must confirm patient identity, the unit
     * label, the group compatibility and the expiry — recorded separately so a
     * single person cannot sign for both.
     */
    checkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    checkedByName: { type: String, trim: true, default: '' },
    witnessedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    witnessedByName: { type: String, trim: true, default: '' },
    checkedAt: { type: Date, default: null },

    bedsideChecks: {
      patientIdentityConfirmed: { type: Boolean, default: false },
      unitLabelMatches: { type: Boolean, default: false },
      groupCompatible: { type: Boolean, default: false },
      expiryChecked: { type: Boolean, default: false },
      unitIntact: { type: Boolean, default: false },
      consentConfirmed: { type: Boolean, default: false },
    },

    startedAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    volumeMl: { type: Number, default: null, min: 0 },

    observations: { type: [observationSchema], default: [] },

    stoppedAt: { type: Date, default: null },
    stopReason: { type: String, trim: true, default: '' },

    discardedReason: { type: String, trim: true, default: '' },

    /** Set when a reaction was reported against this transfusion. */
    hadReaction: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: 'transfusions',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

transfusionSchema.plugin(auditable);
transfusionSchema.index({ patientId: 1, startedAt: -1 });
transfusionSchema.index({ status: 1, startedAt: -1 });

transfusionSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.transfusionNumber) {
    this.transfusionNumber = await nextFormattedId('transfusion', 'TXN', 6);
  }
  next();
});

/**
 * The witness must be a second person.
 *
 * The single most consequential rule in this file: a self-witnessed bedside
 * check provides none of the protection the double-check exists to give.
 */
transfusionSchema.path('witnessedBy').validate(function distinctWitness(value) {
  if (!value || !this.checkedBy) return true;
  return String(value) !== String(this.checkedBy);
}, 'The bedside check must be witnessed by a second person.');

/**
 * A transfusion cannot start until every bedside check is confirmed by two
 * named people. Enforced at the model so no controller, script or import can
 * start one without them.
 */
transfusionSchema.pre('save', function requireChecksBeforeStart(next) {
  if (!this.isModified('status') || this.status !== 'in-progress') return next();

  const checks = this.bedsideChecks || {};
  const missing = Object.entries({
    'patient identity': checks.patientIdentityConfirmed,
    'unit label': checks.unitLabelMatches,
    'group compatibility': checks.groupCompatible,
    expiry: checks.expiryChecked,
    'unit integrity': checks.unitIntact,
  })
    .filter(([, done]) => !done)
    .map(([label]) => label);

  if (missing.length > 0) {
    return next(new Error(`Cannot start the transfusion — unchecked at the bedside: ${missing.join(', ')}.`));
  }
  if (!this.checkedBy || !this.witnessedBy) {
    return next(new Error('A transfusion needs two named people to complete the bedside check.'));
  }
  return next();
});

/** True when the first-15-minute observation is missing on a running unit. */
transfusionSchema.virtual('earlyObservationMissing').get(function missing() {
  if (this.status !== 'in-progress' || !this.startedAt) return false;
  const elapsed = (Date.now() - new Date(this.startedAt)) / 60000;
  if (elapsed < 15) return false;
  return !this.observations.some((o) => o.atMinutes >= 15);
});

export const Transfusion = mongoose.model('Transfusion', transfusionSchema);

/* ==========================================================================
 * REACTION REPORTING
 * ======================================================================= */

/**
 * A transfusion reaction, and its investigation.
 *
 * Reportable to the national haemovigilance programme, and the reason the whole
 * chain above is recorded: without the bedside check and the observations,
 * an investigation has nothing to examine.
 */
const transfusionReactionSchema = new Schema(
  {
    reactionNumber: { type: String, unique: true, index: true },

    transfusionId: { type: Schema.Types.ObjectId, ref: 'Transfusion', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    bloodUnitId: { type: Schema.Types.ObjectId, ref: 'BloodUnit', required: true },

    reactionType: { type: String, enum: REACTION_TYPES, required: true, index: true },
    severity: { type: String, enum: REACTION_SEVERITIES, required: true, index: true },

    onsetAt: { type: Date, required: true },
    /** Minutes into the transfusion — the strongest clue to the mechanism. */
    minutesIntoTransfusion: { type: Number, default: null },

    symptoms: { type: [String], default: [] },
    /** Vitals at the moment the reaction was recognised. */
    vitalsAtOnset: {
      temperature: { type: Number, default: null },
      pulse: { type: Number, default: null },
      systolic: { type: Number, default: null },
      diastolic: { type: Number, default: null },
      oxygenSaturation: { type: Number, default: null },
    },

    transfusionStopped: { type: Boolean, default: true },
    immediateAction: { type: String, trim: true, default: '' },

    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reportedAt: { type: Date, default: Date.now },

    // --- Investigation ------------------------------------------------------
    unitReturnedToBank: { type: Boolean, default: false },
    clericalCheckRepeated: { type: Boolean, default: false },
    /** The finding that separates a bedside error from a laboratory one. */
    clericalErrorFound: { type: Boolean, default: null },
    repeatCrossmatchOrdered: { type: Boolean, default: false },
    directCoombsResult: { type: String, trim: true, default: '' },
    cultureResult: { type: String, trim: true, default: '' },

    investigatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    investigationConclusion: { type: String, trim: true, default: '' },
    investigationClosedAt: { type: Date, default: null },

    outcome: {
      type: String,
      enum: ['recovered', 'recovering', 'sequelae', 'died', 'unknown', ''],
      default: '',
    },

    /** Reported onward to the national haemovigilance programme. */
    reportedToHaemovigilance: { type: Boolean, default: false },
    haemovigilanceReference: { type: String, trim: true, default: '' },
    reportedToHaemovigilanceAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'transfusionReactions',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

transfusionReactionSchema.plugin(auditable);
transfusionReactionSchema.index({ severity: 1, reportedAt: -1 });
transfusionReactionSchema.index({ reportedToHaemovigilance: 1, severity: 1 });

transfusionReactionSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.reactionNumber) {
    this.reactionNumber = await nextFormattedId('transfusionReaction', 'TXR', 5);
  }
  next();
});

export const TransfusionReaction = mongoose.model('TransfusionReaction', transfusionReactionSchema);

export default { Transfusion, TransfusionReaction };
