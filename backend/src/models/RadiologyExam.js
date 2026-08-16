import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const MODALITIES = [
  'xray',
  'ct',
  'mri',
  'ultrasound',
  'mammography',
  'fluoroscopy',
  'nuclear',
];

export const MODALITY_LABELS = Object.freeze({
  xray: 'X-ray',
  ct: 'CT',
  mri: 'MRI',
  ultrasound: 'Ultrasound',
  mammography: 'Mammography',
  fluoroscopy: 'Fluoroscopy',
  nuclear: 'Nuclear medicine',
});

/**
 * The imaging catalogue — the radiology counterpart of `labTests`.
 *
 * An entry is a bookable *examination*, not a machine: "CT head without
 * contrast" and "CT head with contrast" are two entries because they carry
 * different preparation, duration and price, even though both run on the same
 * scanner. Orders snapshot the entry, so re-pricing never rewrites what a past
 * patient was charged.
 */
const radiologyExamSchema = new Schema(
  {
    code: {
      type: String,
      required: [true, 'Exam code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Exam name is required'], trim: true },
    description: { type: String, trim: true, default: '' },

    modality: { type: String, enum: MODALITIES, required: true, index: true },
    /** Anatomy imaged, e.g. 'Chest', 'Head', 'Right knee'. */
    bodyPart: { type: String, required: [true, 'Body part is required'], trim: true },

    /** Owning department — drives revenue attribution on billing lines. */
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'An exam must belong to a department'],
      index: true,
    },

    price: { type: Number, required: [true, 'Price is required'], min: 0 },

    /** Scanner time to reserve, used by scheduling. */
    durationMinutes: { type: Number, min: 5, max: 480, default: 15 },

    contrastRequired: { type: Boolean, default: false },
    /**
     * Ionising dose in mSv, indicative only. Ultrasound and MRI are zero;
     * shown to the ordering clinician so repeat imaging is a visible decision.
     */
    typicalDoseMsv: { type: Number, min: 0, default: 0 },

    preparationNotes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'radiologyExams',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

radiologyExamSchema.plugin(auditable);

radiologyExamSchema.index({ modality: 1, isActive: 1 });
radiologyExamSchema.index({ name: 1 });

export const RadiologyExam = mongoose.model('RadiologyExam', radiologyExamSchema);
export default RadiologyExam;
