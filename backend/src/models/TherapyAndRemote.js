import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { codeableConcept } from './CodeSystem.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * THERAPY (C10), MORTUARY (C11), TELEMEDICINE (C12)
 * ============================================================================
 */

/* ==========================================================================
 * C10 — PHYSIOTHERAPY AND REHABILITATION
 * ======================================================================= */

export const THERAPY_DISCIPLINES = Object.freeze([
  'physiotherapy',
  'occupational-therapy',
  'speech-therapy',
  'psychotherapy',
  'nutrition-counselling',
]);

export const THERAPY_SESSION_STATUSES = Object.freeze([
  'scheduled', 'attended', 'did-not-attend', 'cancelled', 'completed-course',
]);

/**
 * A course of therapy: a referral, a plan, and many sessions against it.
 *
 * Modelled as a course rather than as loose appointments because that is how
 * therapy is prescribed, delivered and billed — "twelve sessions of
 * physiotherapy" is one clinical decision. Loose appointments lose the
 * numerator and denominator that make outcome measurable.
 */
const therapyCourseSchema = new Schema(
  {
    courseNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    discipline: { type: String, enum: THERAPY_DISCIPLINES, required: true, index: true },

    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    indication: { type: String, required: true, trim: true },
    diagnosis: { type: codeableConcept({ required: false }), default: null },

    /** Prescribed course length, against which attendance is measured. */
    plannedSessions: { type: Number, default: null, min: 1 },
    sessionsAttended: { type: Number, default: 0, min: 0 },

    /**
     * Baseline and current scores on whatever measure the discipline uses.
     * Without a baseline there is no way to say whether therapy worked, and
     * "patient feels better" is not a discharge criterion.
     */
    outcomeMeasure: { type: String, trim: true, default: '' },
    baselineScore: { type: Number, default: null },
    currentScore: { type: Number, default: null },
    targetScore: { type: Number, default: null },

    goals: { type: [String], default: [] },
    treatmentPlan: { type: String, trim: true, default: '' },

    startedOn: { type: Date, default: Date.now },
    completedOn: { type: Date, default: null },
    status: {
      type: String,
      enum: ['active', 'completed', 'discontinued', 'on-hold'],
      default: 'active',
      index: true,
    },
    dischargeSummary: { type: String, trim: true, default: '' },
    discontinuedReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'therapyCourses',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

therapyCourseSchema.plugin(auditable);
therapyCourseSchema.index({ patientId: 1, discipline: 1, status: 1 });

therapyCourseSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.courseNumber) {
    this.courseNumber = await nextFormattedId('therapyCourse', 'THR', 6);
  }
  next();
});

/** Change against baseline — the only honest measure of whether it worked. */
therapyCourseSchema.virtual('improvement').get(function improvement() {
  if (this.baselineScore === null || this.currentScore === null) return null;
  return Math.round((this.currentScore - this.baselineScore) * 100) / 100;
});

export const TherapyCourse = mongoose.model('TherapyCourse', therapyCourseSchema);

const therapySessionSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'TherapyCourse', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    sessionNumber: { type: Number, required: true, min: 1 },
    scheduledFor: { type: Date, required: true, index: true },
    status: { type: String, enum: THERAPY_SESSION_STATUSES, default: 'scheduled', index: true },

    therapistId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    startedAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: null, min: 0 },

    interventions: { type: [String], default: [] },
    /** What the patient could do this session — the session-level outcome. */
    progressNote: { type: String, trim: true, default: '' },
    scoreThisSession: { type: Number, default: null },
    homeProgramme: { type: String, trim: true, default: '' },

    didNotAttendReason: { type: String, trim: true, default: '' },
    billingLineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem', default: null },
  },
  {
    timestamps: true,
    collection: 'therapySessions',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

therapySessionSchema.plugin(auditable);
therapySessionSchema.index({ courseId: 1, sessionNumber: 1 }, { unique: true });
therapySessionSchema.index({ therapistId: 1, scheduledFor: 1 });

export const TherapySession = mongoose.model('TherapySession', therapySessionSchema);

/* ==========================================================================
 * C11 — MORTUARY
 * ======================================================================= */

export const BODY_STATUSES = Object.freeze([
  'received', 'in-storage', 'released', 'post-mortem', 'unclaimed', 'disposed',
]);

/**
 * A body in the mortuary.
 *
 * ---------------------------------------------------------------------------
 * IDENTITY ON RELEASE IS THE WHOLE JOB
 * ---------------------------------------------------------------------------
 * Releasing a body to the wrong family is unrecoverable and does happen — most
 * often with unidentified admissions and in mass-casualty situations. So the
 * release requires a named person, their relationship, the identity document
 * shown, and a second staff member: the same two-person discipline as the
 * transfusion bedside check, for the same reason.
 *
 * An MLC body cannot be released at all until the police clear it, which the
 * model enforces rather than leaving to whoever is on the desk.
 */
const mortuaryRecordSchema = new Schema(
  {
    recordNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    deathRecordId: { type: Schema.Types.ObjectId, ref: 'DeathRecord', default: null },
    medicoLegalCaseId: { type: Schema.Types.ObjectId, ref: 'MedicoLegalCase', default: null, index: true },

    /** Unidentified bodies are common; a name may never be known. */
    isUnidentified: { type: Boolean, default: false, index: true },
    descriptionIfUnidentified: { type: String, trim: true, default: '' },
    deceasedName: { type: String, trim: true, default: '' },

    receivedAt: { type: Date, default: Date.now, required: true, index: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedFrom: { type: String, trim: true, default: '' },

    /** Cabinet or tray. */
    storageUnit: { type: String, trim: true, default: '', index: true },
    storageTemperatureC: { type: Number, default: null },

    status: { type: String, enum: BODY_STATUSES, default: 'received', index: true },

    /** Belongings handed over with the body, itemised to avoid disputes. */
    belongings: {
      type: [
        new Schema(
          { item: { type: String, required: true, trim: true }, note: { type: String, trim: true, default: '' } },
          { _id: true },
        ),
      ],
      default: [],
    },

    postMortemRequired: { type: Boolean, default: false },
    postMortemAt: { type: Date, default: null },
    postMortemBy: { type: String, trim: true, default: '' },
    postMortemReportPath: { type: String, trim: true, default: '' },

    /** Police clearance — required before an MLC body may leave. */
    policeClearanceObtained: { type: Boolean, default: false },
    policeClearanceRef: { type: String, trim: true, default: '' },

    // --- Release ------------------------------------------------------------
    releasedAt: { type: Date, default: null },
    releasedTo: { type: String, trim: true, default: '' },
    releasedToRelation: { type: String, trim: true, default: '' },
    releasedToIdType: { type: String, trim: true, default: '' },
    releasedToIdNumber: { type: String, trim: true, default: '' },
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Second signature, same discipline as a transfusion check. */
    releaseWitnessedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    unclaimedNotifiedAt: { type: Date, default: null },
    disposalMethod: { type: String, trim: true, default: '' },
    disposedAt: { type: Date, default: null },

    storageChargeAmount: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'mortuaryRecords',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

mortuaryRecordSchema.plugin(auditable);
mortuaryRecordSchema.index({ status: 1, receivedAt: 1 });
mortuaryRecordSchema.index({ storageUnit: 1, status: 1 });

mortuaryRecordSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.recordNumber) {
    this.recordNumber = await nextFormattedId('mortuary', 'MOR', 6);
  }
  next();
});

/**
 * Release requires identity, a witness, and police clearance for an MLC.
 * Enforced here because the desk is exactly where the pressure to skip it is.
 */
mortuaryRecordSchema.pre('save', function guardRelease(next) {
  if (!this.isModified('status') || this.status !== 'released') return next();

  const missing = [];
  if (!this.releasedTo) missing.push('who it was released to');
  if (!this.releasedToIdNumber) missing.push('the identity document shown');
  if (!this.releasedBy) missing.push('the releasing staff member');
  if (!this.releaseWitnessedBy) missing.push('a witness');

  if (missing.length > 0) {
    return next(new Error(`A body cannot be released without: ${missing.join(', ')}.`));
  }
  if (String(this.releaseWitnessedBy) === String(this.releasedBy)) {
    return next(new Error('The release witness must be a second person.'));
  }
  if (this.medicoLegalCaseId && !this.policeClearanceObtained) {
    return next(
      new Error('This is a medico-legal case. Police clearance is required before the body is released.'),
    );
  }
  return next();
});

/** Days in storage — drives the unclaimed-body process and the charge. */
mortuaryRecordSchema.virtual('storageDays').get(function days() {
  const end = this.releasedAt ? new Date(this.releasedAt) : new Date();
  return Math.floor((end - new Date(this.receivedAt)) / 86400000);
});

export const MortuaryRecord = mongoose.model('MortuaryRecord', mortuaryRecordSchema);

/* ==========================================================================
 * C12 — TELEMEDICINE
 * ======================================================================= */

export const TELE_MODALITIES = Object.freeze(['video', 'audio', 'store-and-forward', 'chat']);
export const TELE_STATUSES = Object.freeze([
  'requested', 'scheduled', 'in-progress', 'completed', 'failed-connection', 'cancelled', 'no-show',
]);

/**
 * A remote consultation.
 *
 * Nepal's geography makes this worth more here than almost anywhere, and the
 * pieces already exist: DICOM storage for teleradiology, a patient portal for
 * the patient end, and the referral module for the specialist end.
 *
 * ---------------------------------------------------------------------------
 * CONNECTION QUALITY IS CLINICAL INFORMATION
 * ---------------------------------------------------------------------------
 * A consultation conducted over a link that kept dropping is a consultation
 * with a different evidential weight, and in a dispute the question "could you
 * actually see the patient" is asked. `connectionQuality` and
 * `degradedToAudio` are recorded for that reason, not for IT reporting.
 */
const teleconsultationSchema = new Schema(
  {
    consultationNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },

    modality: { type: String, enum: TELE_MODALITIES, default: 'video' },
    status: { type: String, enum: TELE_STATUSES, default: 'requested', index: true },

    /** The clinician here. */
    clinicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** Where the patient physically is — often a health post with a health worker. */
    remoteSiteName: { type: String, trim: true, default: '' },
    remoteFacilityCode: { type: String, trim: true, default: '' },
    remoteAttendantName: { type: String, trim: true, default: '' },

    scheduledFor: { type: Date, default: null, index: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    /** Never store a joinable link long-term; it is a door into the session. */
    sessionReference: { type: String, trim: true, default: '' },

    connectionQuality: { type: String, enum: ['good', 'fair', 'poor', ''], default: '' },
    degradedToAudio: { type: Boolean, default: false },
    technicalIssues: { type: String, trim: true, default: '' },

    /** Consent to a remote consultation is its own consent. */
    consentObtained: { type: Boolean, default: false },
    consentId: { type: Schema.Types.ObjectId, ref: 'Consent', default: null },

    reasonForConsultation: { type: String, trim: true, default: '' },
    clinicalNoteId: { type: Schema.Types.ObjectId, ref: 'ClinicalNote', default: null },
    prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', default: null },
    /** Studies reviewed remotely — the teleradiology case. */
    dicomStudyIds: { type: [Schema.Types.ObjectId], ref: 'DicomStudy', default: [] },

    /**
     * A remote consultation that concludes "this patient must be seen" is a
     * success, not a failure, and it is the commonest useful outcome.
     */
    outcome: {
      type: String,
      enum: ['managed-remotely', 'referred-in', 'referred-elsewhere', 'follow-up-scheduled', 'inconclusive', ''],
      default: '',
    },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', default: null },
    billingLineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem', default: null },
  },
  {
    timestamps: true,
    collection: 'teleconsultations',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

teleconsultationSchema.plugin(auditable);
teleconsultationSchema.index({ status: 1, scheduledFor: 1 });
teleconsultationSchema.index({ clinicianId: 1, scheduledFor: -1 });
teleconsultationSchema.index({ patientId: 1, createdAt: -1 });

teleconsultationSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.consultationNumber) {
    this.consultationNumber = await nextFormattedId('teleconsultation', 'TEL', 6);
  }
  next();
});

teleconsultationSchema.virtual('durationMinutes').get(function duration() {
  if (!this.startedAt || !this.endedAt) return null;
  return Math.round((new Date(this.endedAt) - new Date(this.startedAt)) / 60000);
});

export const Teleconsultation = mongoose.model('Teleconsultation', teleconsultationSchema);

export default { TherapyCourse, TherapySession, MortuaryRecord, Teleconsultation };
