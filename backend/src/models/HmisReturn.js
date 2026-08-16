import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const HMIS_RETURN_STATUSES = Object.freeze([
  'draft', // generated from the data, not yet reviewed
  'under-review', // the statistician is checking it
  'approved', // signed off by the facility in-charge
  'submitted', // sent to DHIS2 / handed to the district office
  'accepted', // the receiving system acknowledged it
  'rejected',
]);

export const RETURN_KINDS = Object.freeze({
  HMIS_MONTHLY: 'hmis-monthly', // the routine monthly return
  EWARS_WEEKLY: 'ewars-weekly', // notifiable disease surveillance
});

/**
 * ============================================================================
 * A STATUTORY RETURN TO MoHP
 * ============================================================================
 *
 * Every health facility in Nepal owes the Ministry a monthly HMIS return, and
 * hospital sentinel sites owe a weekly EWARS notifiable-disease report. The
 * data already sits in this system; today someone would transcribe it into a
 * paper register by hand, which is both the pain point that sells an HMS here
 * and the source of most reporting error.
 *
 * ---------------------------------------------------------------------------
 * A RETURN IS A DOCUMENT, NOT A QUERY
 * ---------------------------------------------------------------------------
 * It would be tempting to generate these on demand. They are stored instead,
 * because a submitted return is a statement the facility made on a date and
 * must be able to reproduce. Late data entry changes what the same query would
 * return next week; the return must not silently change with it. So the figures
 * are frozen at generation, `regeneratedFrom` records any restatement, and the
 * variance between the two is visible.
 *
 * The reporting period is expressed in BS, because that is the period MoHP
 * asks about — a "Shrawan return" is not a July return.
 */
const indicatorSchema = new Schema(
  {
    /** The HMIS indicator code, as it appears in the register. */
    code: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    labelNe: { type: String, trim: true, default: '' },
    /** DHIS2 data element uid, when this indicator is pushed electronically. */
    dataElement: { type: String, trim: true, default: '' },
    /** Disaggregation: age band, sex, new/old — DHIS2 category option combo. */
    categoryOptionCombo: { type: String, trim: true, default: '' },
    value: { type: Number, required: true, default: 0 },
    /**
     * Where the number came from, so a district officer querying it can be
     * answered without re-running anything.
     */
    derivation: { type: String, trim: true, default: '' },
    /** Set when a human overrode the computed value, with a reason. */
    overriddenValue: { type: Number, default: null },
    overrideReason: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const hmisReturnSchema = new Schema(
  {
    kind: { type: String, enum: Object.values(RETURN_KINDS), required: true, index: true },

    // --- The period, in Bikram Sambat ---
    bsYear: { type: Number, required: true, index: true },
    /** 1–12 for a monthly return; null for a weekly one. */
    bsMonth: { type: Number, min: 1, max: 12, default: null },
    /** ISO week number for EWARS; null for a monthly return. */
    epiWeek: { type: Number, min: 1, max: 53, default: null },
    fiscalYear: { type: String, required: true, index: true },

    /** The Gregorian window the figures were computed over. */
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    facilityCode: { type: String, trim: true, default: '' },
    facilityName: { type: String, trim: true, default: '' },
    districtCode: { type: String, trim: true, default: '' },

    indicators: { type: [indicatorSchema], default: [] },

    status: { type: String, enum: HMIS_RETURN_STATUSES, default: 'draft', index: true },

    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Sign-off. A return goes out over a named person's authority, and MoHP
     * will come back to that person about it — so it is captured explicitly
     * rather than inferred from whoever clicked submit.
     */
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    reviewNotes: { type: String, trim: true, default: '' },

    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** How it went out: dhis2 push, file export, or handed over on paper. */
    submissionMethod: {
      type: String,
      enum: ['dhis2-api', 'file-export', 'manual', ''],
      default: '',
    },
    dhis2Response: { type: Schema.Types.Mixed, default: null },
    rejectionReason: { type: String, trim: true, default: '' },

    /**
     * Restatement. When late data entry changes the figures after submission,
     * a NEW return is generated pointing back at the old one rather than the
     * old one being edited — the original statement has to survive.
     */
    regeneratedFrom: { type: Schema.Types.ObjectId, ref: 'HmisReturn', default: null },
    restatementReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'hmisReturns',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

hmisReturnSchema.plugin(auditable);

// One live return per facility per period per kind; restatements chain off it.
hmisReturnSchema.index(
  { kind: 1, bsYear: 1, bsMonth: 1, epiWeek: 1, facilityCode: 1, regeneratedFrom: 1 },
  { unique: true },
);
hmisReturnSchema.index({ status: 1, periodEnd: -1 });

/** The value that actually goes on the return — the override wins if set. */
hmisReturnSchema.methods.effectiveValue = function effectiveValue(code) {
  const indicator = this.indicators.find((i) => i.code === code);
  if (!indicator) return null;
  return indicator.overriddenValue ?? indicator.value;
};

/**
 * Remember the status the document was loaded with.
 *
 * The freeze rule below needs the status *before* this save, and reading it off
 * the live document is wrong: by then it may already have been changed in the
 * same edit. `$locals` is the supported place to stash per-document state, so
 * the check does not depend on Mongoose internals.
 */
hmisReturnSchema.post('init', function rememberLoadedStatus() {
  this.$locals.loadedStatus = this.status;
});

const FROZEN_STATUSES = ['approved', 'submitted', 'accepted'];

/**
 * An approved return is frozen; changes require a restatement.
 *
 * A submitted return is a statement the facility made on a date. Late data
 * entry must not silently rewrite it — the original has to survive so the
 * facility can reproduce what it actually said.
 */
hmisReturnSchema.pre('save', function freezeAfterApproval(next) {
  if (this.isNew) return next();
  if (!FROZEN_STATUSES.includes(this.$locals.loadedStatus)) return next();

  if (this.isModified('indicators')) {
    return next(
      new Error(
        `This return was ${this.$locals.loadedStatus}. Generate a restatement ` +
          '(regeneratedFrom) rather than editing the figures in place.',
      ),
    );
  }
  return next();
});

export const HmisReturn = mongoose.model('HmisReturn', hmisReturnSchema);
export default HmisReturn;
