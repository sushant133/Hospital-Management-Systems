import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { DISTRICT_CODES } from '../utils/nepal.js';

const { Schema } = mongoose;

export const HIB_MEMBER_RELATIONSHIPS = Object.freeze([
  'head',
  'spouse',
  'son',
  'daughter',
  'father',
  'mother',
  'father-in-law',
  'mother-in-law',
  'grandfather',
  'grandmother',
  'grandson',
  'granddaughter',
  'brother',
  'sister',
  'other',
]);

export const HIB_HOUSEHOLD_STATUSES = Object.freeze([
  'active',
  'lapsed', // premium not renewed
  'suspended',
  'cancelled',
]);

/**
 * ============================================================================
 * HEALTH INSURANCE BOARD — THE HOUSEHOLD POLICY
 * ============================================================================
 *
 * HIB (स्वास्थ्य बीमा बोर्ड) is the dominant payer for most Nepali hospitals,
 * and it does not behave like the private insurer the generic `PatientPolicy`
 * model assumes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STRUCTURALLY DIFFERENT
 * ---------------------------------------------------------------------------
 * 1. THE POLICY IS A FAMILY, NOT A PERSON. One household enrols, one premium is
 *    paid, and one annual ceiling is SHARED across every member. A per-patient
 *    policy model cannot express "the father's surgery in Mangsir consumed the
 *    ceiling the daughter needs in Falgun" — and that is the single most
 *    important thing the counter needs to know.
 *
 * 2. THE CEILING IS DRAWN DOWN BY THE WHOLE FAMILY. So the balance check must
 *    be at household level and must happen BEFORE treatment, not at billing.
 *    A family told at discharge that their ceiling ran out has a bill nobody
 *    budgeted for.
 *
 * 3. THERE IS A REFERRAL CHAIN. A member is registered to a first contact point
 *    and must ordinarily be referred upward from it. A claim from a hospital
 *    the patient walked into unreferred is rejected — which the hospital only
 *    discovers months later, after the care is delivered and unrecoverable.
 *    `requiresReferral` and the referral check on the claim exist to catch this
 *    at registration, when it can still be fixed.
 *
 * 4. SOME MEMBERS ARE ENROLLED FREE BY GOVERNMENT (senior citizens, ultra-poor,
 *    disabled, FCHVs) rather than paying a premium. They are full members; the
 *    subsidy is recorded so the hospital knows not to chase a premium.
 */
const hibMemberSchema = new Schema(
  {
    // Both are indexed at the parent-schema level below, where the path has to
    // be spelled out anyway. Declaring `index: true` here as well makes Mongoose
    // build the same index twice.
    /** HIB's own member identifier, printed on the card. */
    memberNumber: { type: String, required: true, trim: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },

    /** Name as HIB holds it — may differ from the chart, and HIB's spelling wins on a claim. */
    nameAsRegistered: { type: String, required: true, trim: true },
    relationship: { type: String, enum: HIB_MEMBER_RELATIONSHIPS, required: true },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },

    enrolledOn: { type: Date, default: null },
    /** A member can leave (marriage, death) while the household continues. */
    activeUntil: { type: Date, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { _id: true },
);

const hibHouseholdSchema = new Schema(
  {
    /** HIB's household/family identifier. The key everything else hangs off. */
    householdNumber: { type: String, required: true, unique: true, trim: true, index: true },

    members: { type: [hibMemberSchema], default: [] },

    /** Where the household is enrolled — drives the referral chain. */
    districtCode: { type: String, enum: [...DISTRICT_CODES, ''], default: '', index: true },
    localLevelCode: { type: String, trim: true, default: '' },

    /**
     * The facility this household is registered with. A claim from anywhere
     * else needs a referral from here.
     */
    firstContactPointCode: { type: String, trim: true, default: '' },
    firstContactPointName: { type: String, trim: true, default: '' },

    status: { type: String, enum: HIB_HOUSEHOLD_STATUSES, default: 'active', index: true },

    // --- The policy period and the shared ceiling ---
    policyFrom: { type: Date, required: true },
    policyTo: { type: Date, required: true, index: true },

    /**
     * Annual ceiling shared by every member. HIB's base package covers a family
     * of five with additional cover per extra member — VERIFY THE CURRENT
     * FIGURES, they are revised by the Board.
     */
    ceilingAmount: { type: Number, required: true, min: 0 },
    /** Drawn down by every member's claims within the current policy period. */
    utilisedAmount: { type: Number, default: 0, min: 0 },

    premiumAmount: { type: Number, default: 0, min: 0 },
    premiumPaidOn: { type: Date, default: null },

    /**
     * Government-subsidised enrolment: senior citizens, ultra-poor households,
     * people with disabilities, FCHVs. Recorded so nobody chases a premium that
     * was never the family's to pay.
     */
    subsidised: { type: Boolean, default: false },
    subsidyCategory: { type: String, trim: true, default: '' },

    /** Set false for an emergency, where the referral requirement is waived. */
    requiresReferral: { type: Boolean, default: true },

    /** Copay percentage, where the current scheme terms impose one. */
    copayPercent: { type: Number, min: 0, max: 100, default: 0 },

    lastVerifiedAt: { type: Date, default: null },
    lastVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Raw response from HIB's system on the last eligibility check. */
    lastVerificationResponse: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: 'hibHouseholds',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

hibHouseholdSchema.plugin(auditable);

hibHouseholdSchema.index({ 'members.patientId': 1 });
hibHouseholdSchema.index({ 'members.memberNumber': 1 });
hibHouseholdSchema.index({ status: 1, policyTo: 1 });

/** What is left of the shared ceiling. */
hibHouseholdSchema.virtual('remainingCeiling').get(function remaining() {
  return Math.max(0, (this.ceilingAmount || 0) - (this.utilisedAmount || 0));
});

/** Live cover: active, in date, and with ceiling left. */
hibHouseholdSchema.methods.isCoveredOn = function isCoveredOn(date = new Date()) {
  if (this.status !== 'active') return false;
  if (new Date(this.policyFrom) > date) return false;
  if (new Date(this.policyTo) < date) return false;
  return this.remainingCeiling > 0;
};

/** The membership row for a patient, or null when they are not on this policy. */
hibHouseholdSchema.methods.memberFor = function memberFor(patientId) {
  return (
    this.members.find(
      (m) => m.status === 'active' && String(m.patientId) === String(patientId),
    ) || null
  );
};

export const HibHousehold = mongoose.model('HibHousehold', hibHouseholdSchema);
export default HibHousehold;
