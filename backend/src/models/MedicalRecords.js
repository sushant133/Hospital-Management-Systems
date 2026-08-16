import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const FILE_LOCATIONS = Object.freeze([
  'mrd-shelf',
  'ward',
  'opd',
  'theatre',
  'billing',
  'coding',
  'with-doctor',
  'archived',
  'lost',
]);

export const RELEASE_REQUESTERS = Object.freeze([
  'patient',
  'relative',
  'insurer',
  'police',
  'court',
  'another-hospital',
  'employer',
  'researcher',
]);

export const RELEASE_STATUSES = Object.freeze([
  'received',
  'under-review',
  'approved',
  'partially-approved',
  'refused',
  'released',
]);

/**
 * ============================================================================
 * MEDICAL RECORDS DEPARTMENT (C5)
 * ============================================================================
 *
 * Even with a working EHR, a Nepali hospital runs a physical MRD for years:
 * old charts, consent forms, referral letters, films, and anything a patient
 * carried in. Three jobs the system did not support at all.
 */

/* ==========================================================================
 * 1. FILE MOVEMENT
 * ======================================================================= */

/**
 * Where a physical file is, and who has it.
 *
 * The transition-period problem: a file that has left the shelf and has no
 * recorded holder is, in practice, lost. Recording custody at each handover is
 * the only thing that makes a chart findable when a patient turns up
 * unexpectedly.
 */
const patientFileSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true, index: true },
    fileNumber: { type: String, required: true, trim: true, index: true },

    currentLocation: { type: String, enum: FILE_LOCATIONS, default: 'mrd-shelf', index: true },
    /** Free text for the physical position: "Rack 12, Row C". */
    shelfPosition: { type: String, trim: true, default: '' },
    /** Who signed for it when it left the shelf. */
    heldBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    heldByName: { type: String, trim: true, default: '' },
    issuedAt: { type: Date, default: null },
    /** When it should have come back — drives the overdue list. */
    dueBack: { type: Date, default: null, index: true },

    volumeCount: { type: Number, default: 1, min: 1 },
    /** Retention clock. A chart cannot be destroyed before this date. */
    retainUntil: { type: Date, default: null, index: true },
    archivedAt: { type: Date, default: null },

    movements: {
      type: [
        new Schema(
          {
            from: { type: String, enum: FILE_LOCATIONS, required: true },
            to: { type: String, enum: FILE_LOCATIONS, required: true },
            movedAt: { type: Date, default: Date.now },
            movedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            purpose: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'patientFiles',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

patientFileSchema.plugin(auditable);
patientFileSchema.index({ currentLocation: 1, dueBack: 1 });

/** Out of the MRD past its return date — the chase list. */
patientFileSchema.virtual('isOverdue').get(function overdue() {
  if (this.currentLocation === 'mrd-shelf' || !this.dueBack) return false;
  return new Date(this.dueBack) < new Date();
});

export const PatientFile = mongoose.model('PatientFile', patientFileSchema);

/* ==========================================================================
 * 2. RELEASE OF INFORMATION
 * ======================================================================= */

/**
 * A request for a copy of someone's record.
 *
 * ---------------------------------------------------------------------------
 * THE DEFAULT IS NO
 * ---------------------------------------------------------------------------
 * Insurers, employers and relatives ask for records constantly, and hospital
 * staff hand them over to be helpful. That is a confidentiality breach unless
 * the patient consented or a legal instrument compels it — so `consentObtained`
 * and `legalBasis` are the fields the approval turns on, and a request without
 * either cannot be approved.
 *
 * Police and court requests are the exception and are recorded as such, with
 * the instrument referenced.
 */
const recordReleaseSchema = new Schema(
  {
    requestNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    requesterType: { type: String, enum: RELEASE_REQUESTERS, required: true, index: true },
    requesterName: { type: String, required: true, trim: true },
    requesterOrganisation: { type: String, trim: true, default: '' },
    requesterContact: { type: String, trim: true, default: '' },
    requesterIdShown: { type: String, trim: true, default: '' },

    purpose: { type: String, required: true, trim: true },
    /** What is being asked for — never assume "everything". */
    recordsRequested: { type: [String], default: [] },
    dateRangeFrom: { type: Date, default: null },
    dateRangeTo: { type: Date, default: null },

    /** The patient said yes, and here is the evidence. */
    consentObtained: { type: Boolean, default: false },
    consentDocumentPath: { type: String, trim: true, default: '' },
    consentId: { type: Schema.Types.ObjectId, ref: 'Consent', default: null },

    /** Or the law compels it — court order, police requisition. */
    legalBasis: { type: String, trim: true, default: '' },
    legalDocumentPath: { type: String, trim: true, default: '' },

    status: { type: String, enum: RELEASE_STATUSES, default: 'received', index: true },

    receivedAt: { type: Date, default: Date.now, index: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '' },
    /** What was withheld, and why — a partial release must be explainable. */
    withheldItems: { type: [String], default: [] },
    refusalReason: { type: String, trim: true, default: '' },

    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    releasedTo: { type: String, trim: true, default: '' },
    /** Signature or acknowledgement from whoever collected it. */
    acknowledgementPath: { type: String, trim: true, default: '' },
    pageCount: { type: Number, default: null, min: 0 },
    feeCharged: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    collection: 'recordReleases',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

recordReleaseSchema.plugin(auditable);
recordReleaseSchema.index({ status: 1, receivedAt: -1 });
recordReleaseSchema.index({ patientId: 1, receivedAt: -1 });

/**
 * Approval requires either the patient's consent or a legal basis.
 *
 * Enforced at the model so no controller or import can approve a release that
 * has neither — the single rule that separates records administration from a
 * confidentiality breach.
 */
recordReleaseSchema.pre('save', function requireLawfulBasis(next) {
  const approving = this.isModified('status') && ['approved', 'partially-approved', 'released'].includes(this.status);
  if (!approving) return next();

  const compelled = ['police', 'court'].includes(this.requesterType) && this.legalBasis;
  if (!this.consentObtained && !compelled && !this.legalBasis) {
    return next(
      new Error(
        'A record release needs either the patient’s recorded consent or a stated legal basis. ' +
          'Neither is present.',
      ),
    );
  }
  return next();
});

recordReleaseSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.requestNumber) {
    this.requestNumber = await nextFormattedId('recordRelease', 'ROI', 6);
  }
  next();
});

export const RecordRelease = mongoose.model('RecordRelease', recordReleaseSchema);

/* ==========================================================================
 * 3. THE CODING WORKLIST
 * ======================================================================= */

export const CODING_STATUSES = Object.freeze(['pending', 'in-progress', 'coded', 'queried', 'complete']);

/**
 * A discharged encounter waiting to be coded.
 *
 * This is where B1's ICD work actually bites. Coding is deliberately not
 * enforced at the point of care — a clinician mid-consult should not be blocked
 * by a code picker — so it has to be enforced somewhere, and this is the
 * somewhere: the MRD coder's queue, which is where the job really happens.
 *
 * A queue rather than a flag on the encounter because it carries its own
 * workflow: assignment, queries back to the clinician, and a completion state
 * that gates the HMIS return.
 */
const codingTaskSchema = new Schema(
  {
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, unique: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    dischargedAt: { type: Date, required: true, index: true },
    status: { type: String, enum: CODING_STATUSES, default: 'pending', index: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedAt: { type: Date, default: null },
    codedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    codedAt: { type: Date, default: null },

    /** Counted at completion, so "how much is uncoded" is one query. */
    diagnosisCount: { type: Number, default: 0, min: 0 },
    codedDiagnosisCount: { type: Number, default: 0, min: 0 },
    procedureCount: { type: Number, default: 0, min: 0 },

    /**
     * A coder cannot invent a diagnosis from an ambiguous note. The query goes
     * back to the clinician rather than being guessed, which is the difference
     * between coded data and made-up data.
     */
    query: { type: String, trim: true, default: '' },
    queriedAt: { type: Date, default: null },
    queriedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    queryAnswer: { type: String, trim: true, default: '' },
    queryAnsweredAt: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'codingTasks',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

codingTaskSchema.plugin(auditable);
codingTaskSchema.index({ status: 1, dischargedAt: 1 });
codingTaskSchema.index({ assignedTo: 1, status: 1 });

/** Fully coded — the condition the HMIS morbidity table depends on. */
codingTaskSchema.virtual('isFullyCoded').get(function coded() {
  return this.diagnosisCount > 0 && this.codedDiagnosisCount >= this.diagnosisCount;
});

/** Days sitting uncoded. Coding backlogs are why HMIS returns are late. */
codingTaskSchema.virtual('ageDays').get(function age() {
  if (['coded', 'complete'].includes(this.status)) return null;
  return Math.floor((Date.now() - new Date(this.dischargedAt)) / 86400000);
});

export const CodingTask = mongoose.model('CodingTask', codingTaskSchema);

export default { PatientFile, RecordRelease, CodingTask };
