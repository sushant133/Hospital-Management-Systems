import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFiscalSequence } from '../utils/sequence.js';
import { codeableConcept } from './CodeSystem.js';
import { DISTRICT_CODES, MAX_WARD_NO } from '../utils/nepal.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * BIRTH AND DEATH RECORDS (B7)
 * ============================================================================
 *
 * Two legally-required records the system produced neither of. Kept in one
 * module because they share the registration pathway — both are reported to the
 * local ward office, both feed the HMIS return, and both are documents a family
 * needs in their hand before they leave the building.
 *
 * The patient model's `status: 'deceased'` was the entire previous
 * implementation: a flag with no time of death, no certifying doctor, no cause,
 * and no certificate. A family could not register the death, and the hospital
 * could not report its mortality.
 */

/* ==========================================================================
 * DEATH
 * ======================================================================= */

export const DEATH_MANNERS = Object.freeze([
  'natural',
  'accident',
  'suicide',
  'homicide',
  'undetermined',
  'pending-investigation',
]);

export const DEATH_PLACES = Object.freeze(['ward', 'icu', 'emergency', 'theatre', 'brought-dead', 'other']);

/**
 * ----------------------------------------------------------------------------
 * MEDICAL CERTIFICATE OF CAUSE OF DEATH
 * ----------------------------------------------------------------------------
 * The MCCD is not free text. It follows the international two-part structure,
 * and getting it right is what makes national mortality statistics mean
 * anything:
 *
 *   Part I  — the causal chain, most immediate FIRST, each caused by the one
 *             below it. The last line is the UNDERLYING cause, and that is the
 *             one that gets counted.
 *   Part II — other significant conditions contributing but not in the chain.
 *
 * The commonest error is writing a mode of dying ("cardiac arrest",
 * "respiratory failure") as the underlying cause. Everyone dies of cardiac
 * arrest; it explains nothing. `isModeOfDying` flags those terms so the
 * certifying doctor is asked for the condition beneath.
 */
const causeLineSchema = new Schema(
  {
    /** Ia, Ib, Ic, Id — the chain, most immediate first. */
    line: { type: String, enum: ['Ia', 'Ib', 'Ic', 'Id'], required: true },
    condition: { type: String, required: true, trim: true },
    concept: { type: codeableConcept({ required: false }), default: null },
    /** Interval between onset and death, as the form requires. */
    interval: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const deathRecordSchema = new Schema(
  {
    deathRecordNumber: { type: String, unique: true, index: true },
    fiscalYear: { type: String, required: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null, index: true },

    diedAt: { type: Date, required: true, index: true },
    place: { type: String, enum: DEATH_PLACES, required: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null },

    /** Who pronounced death, and when. Distinct from who certifies the cause. */
    pronouncedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pronouncedAt: { type: Date, required: true, default: Date.now },

    // --- MCCD --------------------------------------------------------------
    causeChain: { type: [causeLineSchema], default: [] },
    contributingConditions: {
      type: [
        new Schema(
          {
            condition: { type: String, required: true, trim: true },
            concept: { type: codeableConcept({ required: false }), default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /**
     * The last line of the chain — what national statistics count. Derived on
     * save so it cannot disagree with the chain it came from.
     */
    underlyingCause: { type: codeableConcept({ required: false }), default: null },
    underlyingCauseText: { type: String, trim: true, default: '' },

    manner: { type: String, enum: DEATH_MANNERS, default: 'natural' },

    certifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    certifiedAt: { type: Date, default: null },
    /** The doctor's council registration, printed on the certificate. */
    certifierRegistration: { type: String, trim: true, default: '' },

    // --- Circumstances that change the pathway ------------------------------
    /**
     * An unnatural or suspicious death cannot be certified normally — it
     * becomes a police matter and usually a post-mortem. Linking the MLC here
     * keeps the two records from being maintained separately and diverging.
     */
    medicoLegalCaseId: { type: Schema.Types.ObjectId, ref: 'MedicoLegalCase', default: null },
    postMortemRequired: { type: Boolean, default: false },
    postMortemDoneAt: { type: Date, default: null },

    /** Maternal and perinatal deaths are separately reportable. */
    isMaternalDeath: { type: Boolean, default: false, index: true },
    isPerinatalDeath: { type: Boolean, default: false, index: true },

    /**
     * Deaths within 48 hours of admission, and intra-operative deaths, go to
     * mortality review. Computed on save rather than left to a human to notice.
     */
    reviewRequired: { type: Boolean, default: false, index: true },
    reviewReason: { type: String, trim: true, default: '' },

    // --- Registration and release -------------------------------------------
    /** Reported to the local ward office for civil registration. */
    registeredWithLocalLevel: { type: Boolean, default: false },
    registeredAt: { type: Date, default: null },
    localRegistrationNumber: { type: String, trim: true, default: '' },

    /** The certificate the family is given. */
    certificatePath: { type: String, trim: true, default: '' },
    certificateIssuedAt: { type: Date, default: null },
    certificateIssuedTo: { type: String, trim: true, default: '' },

    bodyReleasedAt: { type: Date, default: null },
    bodyReleasedTo: { type: String, trim: true, default: '' },
    bodyReleasedToRelation: { type: String, trim: true, default: '' },
    bodyReleaseIdentityCheck: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'deathRecords',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

deathRecordSchema.plugin(auditable);
deathRecordSchema.index({ diedAt: -1 });
deathRecordSchema.index({ reviewRequired: 1, diedAt: -1 });
deathRecordSchema.index({ fiscalYear: 1, isMaternalDeath: 1 });

deathRecordSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.deathRecordNumber) {
    const { number, fiscalYear } = await nextFiscalSequence('deathRecord', 'DTH');
    this.deathRecordNumber = number;
    this.fiscalYear = fiscalYear;
  }
  next();
});

/** Terms that describe how someone died, not what killed them. */
const MODES_OF_DYING = [
  'cardiac arrest',
  'cardiopulmonary arrest',
  'respiratory arrest',
  'respiratory failure',
  'heart failure',
  'multi-organ failure',
  'multiorgan failure',
  'shock',
  'coma',
  'old age',
  'natural causes',
  'asystole',
];

/**
 * The underlying cause is the LAST line of the chain, not the first.
 * Derived here so the certificate, the HMIS return and the statistics can never
 * disagree about which condition was counted.
 */
deathRecordSchema.pre('save', function deriveUnderlyingCause(next) {
  if (this.causeChain?.length > 0) {
    const order = ['Ia', 'Ib', 'Ic', 'Id'];
    const sorted = [...this.causeChain].sort(
      (a, b) => order.indexOf(a.line) - order.indexOf(b.line),
    );
    const last = sorted[sorted.length - 1];
    this.underlyingCause = last.concept || null;
    this.underlyingCauseText = last.condition;
  }

  // Deaths soon after admission or in theatre go to review automatically.
  if (this.isNew && !this.reviewRequired) {
    if (this.place === 'theatre') {
      this.reviewRequired = true;
      this.reviewReason = 'Intra-operative death.';
    } else if (this.isMaternalDeath) {
      this.reviewRequired = true;
      this.reviewReason = 'Maternal death — separately reportable.';
    }
  }

  next();
});

/**
 * Refuse a mode of dying as the underlying cause.
 *
 * "Cardiac arrest" as an underlying cause is the commonest MCCD error and makes
 * the record statistically worthless — everyone's heart stops. The certifying
 * doctor is asked for the condition beneath it.
 */
deathRecordSchema.path('causeChain').validate(function rejectModeOfDying(chain) {
  if (!chain || chain.length === 0) return true;
  const order = ['Ia', 'Ib', 'Ic', 'Id'];
  const sorted = [...chain].sort((a, b) => order.indexOf(a.line) - order.indexOf(b.line));
  const underlying = sorted[sorted.length - 1]?.condition?.toLowerCase().trim() || '';
  return !MODES_OF_DYING.some((mode) => underlying === mode || underlying.includes(mode));
}, 'The last line of the chain is the underlying cause and cannot be a mode of dying (cardiac arrest, respiratory failure, shock…). State the condition that caused it.');

/** Hours between admission and death — drives the 48-hour review rule. */
deathRecordSchema.virtual('hoursFromAdmission').get(function hours() {
  if (!this.populated('encounterId') || !this.encounterId?.admittedAt) return null;
  return Math.floor((new Date(this.diedAt) - new Date(this.encounterId.admittedAt)) / 3600000);
});

export const DeathRecord = mongoose.model('DeathRecord', deathRecordSchema);

/* ==========================================================================
 * BIRTH
 * ======================================================================= */

export const DELIVERY_TYPES = Object.freeze([
  'normal-vaginal',
  'assisted-vaginal',
  'caesarean',
  'breech',
  'other',
]);

export const BIRTH_OUTCOMES = Object.freeze(['live-birth', 'stillbirth', 'macerated-stillbirth']);

const birthRecordSchema = new Schema(
  {
    birthRecordNumber: { type: String, unique: true, index: true },
    fiscalYear: { type: String, required: true, index: true },

    /** The mother's chart. Always present — a birth happens to someone. */
    motherPatientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    /**
     * The baby's own chart, once registered. Null for a stillbirth, and null
     * briefly for a live birth before registration — which is exactly why it is
     * nullable rather than required.
     */
    babyPatientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    maternityCaseId: { type: Schema.Types.ObjectId, ref: 'MaternityCase', default: null },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },

    bornAt: { type: Date, required: true, index: true },
    outcome: { type: String, enum: BIRTH_OUTCOMES, required: true, index: true },
    deliveryType: { type: String, enum: DELIVERY_TYPES, required: true },

    sex: { type: String, enum: ['male', 'female', 'ambiguous'], required: true },
    birthWeightGrams: { type: Number, default: null, min: 0 },
    gestationWeeks: { type: Number, default: null, min: 0, max: 50 },
    apgarOneMinute: { type: Number, default: null, min: 0, max: 10 },
    apgarFiveMinute: { type: Number, default: null, min: 0, max: 10 },

    /** Multiple births: 1 of 2, 2 of 2. */
    birthOrder: { type: Number, default: 1, min: 1 },
    totalInBirth: { type: Number, default: 1, min: 1 },

    attendedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    attendantType: {
      type: String,
      enum: ['doctor', 'nurse-midwife', 'anm', 'other', ''],
      default: '',
    },

    /** Details the ward office needs for civil registration. */
    motherName: { type: String, trim: true, default: '' },
    fatherName: { type: String, trim: true, default: '' },
    permanentDistrict: { type: String, enum: [...DISTRICT_CODES, ''], default: '' },
    permanentLocalLevel: { type: String, trim: true, default: '' },
    permanentWardNo: { type: Number, min: 1, max: MAX_WARD_NO, default: null },

    registeredWithLocalLevel: { type: Boolean, default: false },
    registeredAt: { type: Date, default: null },
    localRegistrationNumber: { type: String, trim: true, default: '' },

    certificatePath: { type: String, trim: true, default: '' },
    certificateIssuedAt: { type: Date, default: null },
    certificateIssuedTo: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'birthRecords',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

birthRecordSchema.plugin(auditable);
birthRecordSchema.index({ bornAt: -1 });
birthRecordSchema.index({ outcome: 1, bornAt: -1 });
birthRecordSchema.index({ registeredWithLocalLevel: 1, bornAt: -1 });

birthRecordSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.birthRecordNumber) {
    const { number, fiscalYear } = await nextFiscalSequence('birthRecord', 'BTH');
    this.birthRecordNumber = number;
    this.fiscalYear = fiscalYear;
  }
  next();
});

/** Under 2500g — reportable, and drives newborn care pathways. */
birthRecordSchema.virtual('isLowBirthWeight').get(function low() {
  return this.birthWeightGrams !== null && this.birthWeightGrams < 2500;
});

birthRecordSchema.virtual('isPreterm').get(function preterm() {
  return this.gestationWeeks !== null && this.gestationWeeks < 37;
});

export const BirthRecord = mongoose.model('BirthRecord', birthRecordSchema);

export default { DeathRecord, BirthRecord };
