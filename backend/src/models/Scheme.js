import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * GOVERNMENT HEALTH SCHEMES
 * ============================================================================
 *
 * A large share of a Nepali hospital's patients are billed under a scheme
 * rather than out of pocket, and each scheme has its own eligibility test,
 * covered-service list, ceiling and claim route back to government.
 *
 * ---------------------------------------------------------------------------
 * A SCHEME IS NOT A DISCOUNT
 * ---------------------------------------------------------------------------
 * This is the distinction the old model got wrong. A discount is revenue the
 * hospital chooses to forgo. A scheme is revenue owed to the hospital *by
 * someone other than the patient*. Recording free care as a discount is how a
 * hospital silently writes off money it was entitled to reclaim — the care is
 * delivered, the patient pays nothing, and nobody ever files the claim.
 *
 * So scheme coverage lands in `Invoice.schemeCoveredAmount` (a receivable) and
 * raises a `SchemeClaim`, never in `discountAmount`.
 *
 * ---------------------------------------------------------------------------
 * RATES AND CEILINGS ARE DATA, NOT CODE
 * ---------------------------------------------------------------------------
 * Every figure below moves with the annual budget and with MoHP directives.
 * They live in the database so a change is a settings edit by the hospital's
 * accounts office, not a code release. The seed ships current-at-writing
 * values; VERIFY THEM against the operative directive before going live.
 */

/** How a scheme decides what it pays on a given bill. */
export const COVERAGE_MODES = Object.freeze({
  /** Pays 100% of covered services, up to the ceiling. */
  FULL: 'full',
  /** Pays a fixed percentage of covered services. */
  PERCENTAGE: 'percentage',
  /** Pays a flat amount per episode regardless of the bill (e.g. incentives). */
  FLAT_PER_EPISODE: 'flat-per-episode',
  /** Pays against a published package price for the procedure. */
  PACKAGE_RATE: 'package-rate',
});

export const COVERAGE_MODE_VALUES = Object.freeze(Object.values(COVERAGE_MODES));

/** What resets the ceiling. */
export const CEILING_PERIODS = Object.freeze(['fiscal-year', 'lifetime', 'episode', 'none']);

/** Who the scheme is claimed from. */
export const CLAIM_ROUTES = Object.freeze([
  'hib', // Health Insurance Board
  'mohp', // Ministry of Health and Population / department
  'provincial', // provincial health directorate
  'local', // palika
  'none', // no reimbursement — genuinely free care the hospital absorbs
]);

const eligibilityRuleSchema = new Schema(
  {
    /**
     * What must be true of the patient. Kept as a small declarative set rather
     * than free-form code so a non-developer can read why a patient qualified,
     * and so the decision can be replayed during an audit.
     */
    field: {
      type: String,
      required: true,
      enum: [
        'age-min', // senior citizen schemes
        'age-max', // child schemes
        'gender', // maternity
        'has-identifier', // disability card, senior citizen card…
        'identifier-category', // disability Ka/Kha/Ga/Gha
        'diagnosis-in', // Bipanna Nagarik's listed conditions
        'service-in', // free dialysis
        'district-in', // locally funded schemes
        'income-below', // means-tested
      ],
    },
    value: { type: Schema.Types.Mixed, required: true },
    /** Human-readable, printed on the entitlement decision. */
    description: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const schemeSchema = new Schema(
  {
    /** Stable machine key, e.g. `senior-citizen`. Never renamed. */
    code: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },

    name: { type: String, required: true, trim: true },
    nameNe: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },

    coverageMode: { type: String, enum: COVERAGE_MODE_VALUES, required: true },
    /** For `percentage` mode. */
    coveragePercent: { type: Number, min: 0, max: 100, default: 100 },
    /** For `flat-per-episode` mode. */
    flatAmount: { type: Number, min: 0, default: 0 },

    /** Maximum the scheme will pay before the patient becomes liable. */
    ceilingAmount: { type: Number, min: 0, default: 0 },
    ceilingPeriod: { type: String, enum: CEILING_PERIODS, default: 'fiscal-year' },

    /**
     * Which charges the scheme covers. Empty means "everything on the bill".
     * Matched against `BillingLineItem.sourceType` and the service code.
     */
    coveredSourceTypes: { type: [String], default: [] },
    coveredServiceCodes: { type: [String], default: [] },
    /** Explicitly never covered, even when the list above would include them. */
    excludedServiceCodes: { type: [String], default: [] },

    eligibility: { type: [eligibilityRuleSchema], default: [] },

    claimRoute: { type: String, enum: CLAIM_ROUTES, required: true },
    /** Days after discharge within which the claim must be filed. */
    claimWindowDays: { type: Number, min: 0, default: 90 },

    /**
     * Requires a card/document to be sighted and recorded before the scheme can
     * be applied. Nearly all of them do — applying free care without the card
     * is the classic audit finding.
     */
    requiresDocument: { type: Boolean, default: true },
    documentLabel: { type: String, trim: true, default: '' },

    /** Directives change; an inactive scheme stops applying to new bills. */
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },

    /** The directive or circular this scheme's terms come from. */
    authorityReference: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'schemes',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

schemeSchema.plugin(auditable);
schemeSchema.index({ isActive: 1, code: 1 });

/** Whether the scheme applies on a given date. */
schemeSchema.methods.isEffectiveOn = function isEffectiveOn(date = new Date()) {
  if (!this.isActive) return false;
  if (this.effectiveFrom && new Date(this.effectiveFrom) > date) return false;
  if (this.effectiveTo && new Date(this.effectiveTo) < date) return false;
  return true;
};

export const Scheme = mongoose.model('Scheme', schemeSchema);
export default Scheme;
