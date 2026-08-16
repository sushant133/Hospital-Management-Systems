import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { codeableConcept } from './CodeSystem.js';
import { DISTRICT_CODES } from '../utils/nepal.js';

const { Schema } = mongoose;

export const REFERRAL_DIRECTIONS = Object.freeze(['inbound', 'outbound']);

export const REFERRAL_STATUSES = Object.freeze([
  'draft',
  'issued', // letter generated, patient on their way
  'acknowledged', // receiving facility confirmed arrival
  'completed', // treatment done, outcome known
  'declined', // receiving facility could not take them
  'cancelled',
  'lapsed', // patient never arrived
]);

export const REFERRAL_TRANSITIONS = Object.freeze({
  draft: ['issued', 'cancelled'],
  issued: ['acknowledged', 'declined', 'lapsed', 'cancelled'],
  acknowledged: ['completed', 'declined'],
  completed: [],
  declined: [],
  cancelled: [],
  lapsed: [],
});

export const REFERRAL_URGENCY = Object.freeze(['routine', 'urgent', 'emergency']);

/** Why a patient is being sent on. Drives the HMIS referral breakdown. */
export const REFERRAL_REASONS = Object.freeze([
  'higher-level-care',
  'specialist-opinion',
  'investigation-unavailable',
  'bed-unavailable',
  'equipment-unavailable',
  'blood-unavailable',
  'surgery-required',
  'icu-required',
  'patient-request',
  'other',
]);

/**
 * ============================================================================
 * REFERRAL — IN AND OUT
 * ============================================================================
 *
 * The most consequential of the missing operational modules for Nepal, for
 * three separate reasons that all bite differently:
 *
 * 1. HIB REIMBURSEMENT DEPENDS ON IT. A Health Insurance Board member is
 *    registered to a first contact point and must ordinarily be referred upward
 *    from it. A claim from a hospital the patient walked into unreferred is
 *    rejected — months later, after the care is delivered and the patient has
 *    gone home believing they owed nothing.
 *
 * 2. IT IS HOW THE SYSTEM MOVES PATIENTS. Primary → district → provincial →
 *    central is the designed pathway, and a district hospital sending a case to
 *    Kathmandu is a daily event that currently happens on a handwritten slip.
 *
 * 3. MoHP COUNTS IT. Referrals in and out are HMIS indicators.
 *
 * ---------------------------------------------------------------------------
 * ONE MODEL, BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * Inbound and outbound share every field that matters (who, from where, why,
 * what was done, what came back) and differ only in which end this hospital
 * occupies. Two models would duplicate the clinical summary, the document
 * handling and the outcome loop, and would make "show me this patient's
 * referral history" a union query.
 *
 * `Encounter.referral` still exists and is NOT redundant: it is the lightweight
 * snapshot captured at registration so the HIB eligibility check has something
 * to test before a full referral record is raised.
 */
const referralSchema = new Schema(
  {
    referralNumber: { type: String, unique: true, index: true },

    direction: { type: String, enum: REFERRAL_DIRECTIONS, required: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null, index: true },

    // --- The other facility ------------------------------------------------
    /**
     * Free-form rather than a foreign key on purpose: most referring facilities
     * are health posts and private clinics that will never exist as rows in this
     * hospital's database. `facilityCode` holds the national HFR code when the
     * clerk knows it, which is what makes district-level aggregation possible.
     */
    facilityCode: { type: String, trim: true, default: '', index: true },
    facilityName: { type: String, required: true, trim: true },
    facilityLevel: {
      type: String,
      enum: ['community', 'health-post', 'phcc', 'primary', 'district', 'provincial', 'central', 'private', 'abroad', ''],
      default: '',
    },
    facilityDistrict: { type: String, enum: [...DISTRICT_CODES, ''], default: '', index: true },

    /** The doctor at the other end, and how to reach them. */
    counterpartDoctor: { type: String, trim: true, default: '' },
    counterpartContact: { type: String, trim: true, default: '' },

    /**
     * True when this referral came from the patient's HIB first contact point.
     * The single field that decides whether the claim is payable.
     */
    isFirstContactPoint: { type: Boolean, default: false },

    // --- Clinical content --------------------------------------------------
    urgency: { type: String, enum: REFERRAL_URGENCY, default: 'routine', index: true },
    reason: { type: String, enum: REFERRAL_REASONS, required: true },
    reasonNote: { type: String, trim: true, default: '' },

    /** Coded, so referral patterns can be analysed by condition (B1). */
    diagnosis: { type: [codeableConcept({ required: false })], default: [] },
    /** The narrative a receiving clinician actually reads. */
    clinicalSummary: { type: String, trim: true, default: '' },
    investigationsDone: { type: String, trim: true, default: '' },
    treatmentGiven: { type: String, trim: true, default: '' },
    /** Department or specialty being referred to. */
    referredToSpecialty: { type: String, trim: true, default: '' },

    /** Scans of the letter and any accompanying reports. */
    documents: {
      type: [
        new Schema(
          {
            label: { type: String, trim: true, required: true },
            path: { type: String, trim: true, required: true },
            uploadedAt: { type: Date, default: Date.now },
            uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    /** The generated referral letter PDF, once issued. */
    letterPath: { type: String, trim: true, default: '' },

    status: { type: String, enum: REFERRAL_STATUSES, default: 'draft', index: true },

    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    referredAt: { type: Date, default: null, index: true },
    /** For inbound: the date written on the letter the patient carried in. */
    referralDate: { type: Date, default: null },

    acknowledgedAt: { type: Date, default: null },
    acknowledgedNote: { type: String, trim: true, default: '' },

    // --- The loop back -----------------------------------------------------
    /**
     * THE BACK-REFERRAL, and the part every paper system loses.
     *
     * A referring clinician almost never learns what happened to the patient
     * they sent away. Without it there is no feedback on whether the referral
     * was appropriate, the patient arrives home with no follow-up plan, and the
     * referring facility cannot close its own record.
     */
    outcome: {
      type: String,
      enum: ['treated-returned', 'treated-retained', 'admitted', 'died', 'referred-onward', 'not-attended', ''],
      default: '',
    },
    outcomeSummary: { type: String, trim: true, default: '' },
    outcomeDiagnosis: { type: [codeableConcept({ required: false })], default: [] },
    followUpPlan: { type: String, trim: true, default: '' },
    outcomeReceivedAt: { type: Date, default: null },
    outcomeRecordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    declineReason: { type: String, trim: true, default: '' },
    cancelReason: { type: String, trim: true, default: '' },

    /** Transport used, linking to the ambulance trip when there was one. */
    ambulanceTripId: { type: Schema.Types.ObjectId, ref: 'AmbulanceTrip', default: null },
  },
  {
    timestamps: true,
    collection: 'referrals',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

referralSchema.plugin(auditable);

referralSchema.index({ patientId: 1, createdAt: -1 });
referralSchema.index({ direction: 1, status: 1, referredAt: -1 });
// The "sent out and never heard back" worklist.
referralSchema.index({ direction: 1, status: 1, outcomeReceivedAt: 1 });

referralSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.referralNumber) {
    const prefix = this.direction === 'outbound' ? 'REF-O' : 'REF-I';
    this.referralNumber = await nextFormattedId(`referral:${this.direction}`, prefix, 6);
  }
  next();
});

/** Sent out, acknowledged, and still no outcome — the loop that never closed. */
referralSchema.virtual('awaitingOutcome').get(function awaiting() {
  return (
    this.direction === 'outbound' &&
    ['issued', 'acknowledged'].includes(this.status) &&
    !this.outcomeReceivedAt
  );
});

/** Days since the patient was sent, for the follow-up worklist. */
referralSchema.virtual('daysOutstanding').get(function days() {
  if (!this.referredAt || this.outcomeReceivedAt) return null;
  return Math.floor((Date.now() - new Date(this.referredAt)) / 86400000);
});

export const Referral = mongoose.model('Referral', referralSchema);
export default Referral;
