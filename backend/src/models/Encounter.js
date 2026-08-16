import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { codeableConcept } from './CodeSystem.js';

const { Schema } = mongoose;

export const ENCOUNTER_TYPES = ['opd', 'ipd', 'emergency', 'daycare'];
export const ENCOUNTER_STATUSES = ['open', 'admitted', 'discharged', 'cancelled'];

/**
 * A diagnosis on this encounter.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CODE IS A CONCEPT AND NOT A STRING
 * ---------------------------------------------------------------------------
 * The old shape was `{ code: String, description: String }` with no dictionary
 * behind it — free text with a code-shaped field beside it. Everything
 * downstream depends on this being real: HMIS morbidity returns, insurance
 * adjudication, scheme eligibility (Bipanna Nagarik's condition list), mortality
 * statistics, and clinical audit. A morbidity table built from uncoded text is
 * not a weak statistic, it is a fabricated one.
 *
 * `concept` is embedded rather than referenced so a diagnosis recorded today
 * still reads the same after the terminology is updated and the code retired —
 * the chart states what the clinician actually chose at the time.
 *
 * `description` survives as the clinician's own words, which are often more
 * specific than any code ("fall from apple tree, closed left Colles").
 */
const diagnosisSchema = new Schema(
  {
    concept: { type: codeableConcept({ required: false }), default: null },
    /** Free text: what the clinician wrote. Never a substitute for the code. */
    description: { type: String, required: true, trim: true },
    type: { type: String, enum: ['primary', 'secondary', 'provisional'], default: 'primary' },

    /**
     * Present on admission vs acquired here. The single field that separates a
     * complication of care from the condition the patient arrived with — and
     * therefore the basis of every HAI and quality measure.
     */
    presentOnAdmission: { type: Boolean, default: null },

    /**
     * Set when this diagnosis is notifiable (cholera, measles, dengue…), so the
     * EWARS report and the alert both key off the record rather than off a list
     * consulted at the end of the week.
     */
    isNotifiable: { type: Boolean, default: false, index: true },
    notifiedAt: { type: Date, default: null },
    notifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * One move within a stay. Recorded rather than overwritten so the ward history
 * survives, and so each night can be billed at the rate of the bed the patient
 * was actually in.
 */
const transferSchema = new Schema(
  {
    fromWardId: { type: Schema.Types.ObjectId, ref: 'Ward' },
    fromBedId: { type: Schema.Types.ObjectId, ref: 'Bed' },
    toWardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true },
    toBedId: { type: Schema.Types.ObjectId, ref: 'Bed', required: true },
    movedAt: { type: Date, default: Date.now, required: true },
    movedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

/**
 * The clinical spine of the system. Every downstream artifact (lab order,
 * prescription, invoice line) references BOTH patientId and encounterId — see
 * both patient and encounter ids.
 */
const encounterSchema = new Schema(
  {
    encounterNumber: { type: String, unique: true, index: true },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Encounter must reference a patient'],
      index: true,
    },

    type: { type: String, enum: ENCOUNTER_TYPES, required: true, index: true },
    status: { type: String, enum: ENCOUNTER_STATUSES, default: 'open', index: true },

    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    attendingDoctorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    chiefComplaint: { type: String, trim: true, default: '' },
    diagnosis: { type: [diagnosisSchema], default: [] },

    /**
     * Inbound referral.
     *
     * Recorded at registration because HIB reimbursement depends on it: a
     * member who walks in unreferred, outside an emergency, produces a claim
     * the Board rejects — and the hospital only finds out months later, after
     * the care is delivered and the patient has gone home believing they owed
     * nothing. Capturing it here is the last moment the paperwork can still be
     * obtained. It also feeds the referral counts in the HMIS return.
     */
    referral: {
      referringFacilityCode: { type: String, trim: true, default: '' },
      referringFacilityName: { type: String, trim: true, default: '' },
      referringDoctor: { type: String, trim: true, default: '' },
      referralDate: { type: Date, default: null },
      reason: { type: String, trim: true, default: '' },
      /** Scan of the referral letter; authenticated download only. */
      documentPath: { type: String, trim: true, default: '' },
      /** True when this referral came from the HIB first contact point. */
      isFirstContactPoint: { type: Boolean, default: false },
    },
    /**
     * Observations are NOT stored here. They are a series — an ICU patient has
     * them hourly — and a single embedded object silently overwrote the
     * previous reading. They live in the `vitalSigns` collection, keyed by both
     * patientId and encounterId; read them via GET /encounters/:id/vitals.
     */

    /**
     * Set when the visit becomes an admission. `wardId`/`bedId` are always the
     * CURRENT placement; `transfers` is the history of how the patient got
     * there, which is what per-night bed charging replays to bill each night at
     * the rate of the bed actually occupied.
     */
    admission: {
      wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null },
      bedId: { type: Schema.Types.ObjectId, ref: 'Bed', default: null },
      admittedAt: { type: Date, default: null },
      admittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      admissionReason: { type: String, trim: true, default: '' },
      expectedDischargeDate: { type: Date, default: null },

      transfers: {
        type: [transferSchema],
        default: [],
      },

      dischargedAt: { type: Date, default: null },
      dischargedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      dischargeSummary: { type: String, trim: true, default: '' },
      dischargeType: {
        type: String,
        enum: ['recovered', 'referred', 'lama', 'transferred', 'deceased', null],
        default: null,
      },
      /** Set once the stay has been billed, so charging stays idempotent. */
      bedChargedThrough: { type: Date, default: null },
    },

    startedAt: { type: Date, default: Date.now, index: true },
    endedAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'encounters',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

encounterSchema.plugin(auditable);

encounterSchema.index({ patientId: 1, startedAt: -1 });
encounterSchema.index({ status: 1, isActive: 1 });

encounterSchema.pre('save', async function assignEncounterNumber(next) {
  if (this.isNew && !this.encounterNumber) {
    this.encounterNumber = await nextFormattedId('encounterNumber', 'ENC', 6);
  }
  next();
});

export const Encounter = mongoose.model('Encounter', encounterSchema);
export default Encounter;
