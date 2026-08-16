import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const RADIOLOGY_RESULT_STATUSES = ['preliminary', 'verified', 'amended'];

/**
 * An image or document stored against a report.
 *
 * `path` is RELATIVE to the uploads root and is never served statically —
 * downloads go through an authenticated, permission-gated route, exactly as lab
 * reports do. These are patient records, not assets.
 */
const attachmentSchema = new Schema(
  {
    path: { type: String, required: true, trim: true },
    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, default: '' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * The radiologist's read of a study.
 *
 * One result per order (imaging is reported as a whole), so this is 1:1 with
 * `radiologyOrders` and enforced by a unique index.
 *
 * `findings` is what is seen; `impression` is what it means. Both are kept —
 * the referring clinician acts on the impression, but the findings are what a
 * later reader compares against.
 */
const radiologyResultSchema = new Schema(
  {
    radiologyOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'RadiologyOrder',
      required: [true, 'Result must reference a radiology order'],
      unique: true,
      index: true,
    },

    // Patient and encounter are both required.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: true,
      index: true,
    },

    /** Technique used, e.g. 'PA and lateral views, no contrast'. */
    technique: { type: String, trim: true, default: '' },
    /** What is seen on the images. */
    findings: { type: String, required: [true, 'Findings are required'], trim: true },
    /** What it means — the line the referring clinician acts on. */
    impression: { type: String, required: [true, 'An impression is required'], trim: true },
    /** Suggested next steps, e.g. 'Correlate clinically, repeat in 6 weeks'. */
    recommendation: { type: String, trim: true, default: '' },

    /**
     * Set when the study shows something needing immediate action. Surfaced on
     * the worklist and banner-flagged on the report, mirroring the lab's
     * critical-value handling. Nothing is pushed from here.
     */
    isCritical: { type: Boolean, default: false, index: true },
    criticalNote: { type: String, trim: true, default: '' },

    attachments: { type: [attachmentSchema], default: [] },

    status: {
      type: String,
      enum: RADIOLOGY_RESULT_STATUSES,
      default: 'preliminary',
      index: true,
    },

    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },

    amendmentReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'radiologyResults',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

radiologyResultSchema.plugin(auditable);

radiologyResultSchema.index({ patientId: 1, createdAt: -1 });
radiologyResultSchema.index({ status: 1, isCritical: 1 });

/** Flagging a study critical without saying why helps nobody who reads it next. */
radiologyResultSchema.pre('validate', function requireCriticalNote(next) {
  if (this.isCritical && !(this.criticalNote ?? '').trim()) {
    return next(new Error('Say what the critical finding is'));
  }
  return next();
});

radiologyResultSchema.virtual('attachmentCount').get(function attachmentCount() {
  return this.attachments?.length ?? 0;
});

export const RadiologyResult = mongoose.model('RadiologyResult', radiologyResultSchema);
export default RadiologyResult;
