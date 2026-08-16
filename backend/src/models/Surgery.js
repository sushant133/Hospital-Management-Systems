import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const SURGERY_STATUSES = ['scheduled', 'in-theatre', 'recovery', 'completed', 'cancelled'];
export const SURGERY_TRANSITIONS = Object.freeze({
  scheduled: ['in-theatre', 'cancelled'],
  'in-theatre': ['recovery', 'cancelled'],
  recovery: ['completed'],
  completed: [],
  cancelled: [],
});

export const THEATRE_ROOMS = ['OT-1', 'OT-2', 'OT-3'];

const checklistItem = {
  checked: { type: Boolean, default: false },
  checkedAt: { type: Date, default: null },
  checkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
};

/**
 * One booked operation. WHO surgical safety checklist is three named blocks
 * (sign-in, time-out, sign-out) rather than a freeform form, so completion
 * can be counted later.
 */
const surgerySchema = new Schema(
  {
    surgeryNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },

    theatre: { type: String, enum: THEATRE_ROOMS, required: true, index: true },
    procedure: { type: String, required: true, trim: true },
    diagnosis: { type: String, trim: true, default: '' },
    laterality: { type: String, enum: ['left', 'right', 'bilateral', 'n/a'], default: 'n/a' },
    priority: { type: String, enum: ['elective', 'urgent', 'emergency'], default: 'elective' },

    scheduledStart: { type: Date, required: true, index: true },
    scheduledEnd: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    surgeonId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    anaesthetistId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assistants: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },

    status: { type: String, enum: SURGERY_STATUSES, default: 'scheduled', index: true },

    whoChecklist: {
      signIn: {
        identityConfirmed: checklistItem,
        siteMarked: checklistItem,
        consentConfirmed: checklistItem,
        allergiesReviewed: checklistItem,
        pulseOximeterOn: checklistItem,
      },
      timeOut: {
        teamIntroduced: checklistItem,
        procedureConfirmed: checklistItem,
        antibioticGiven: checklistItem,
        imagingDisplayed: checklistItem,
      },
      signOut: {
        procedureRecorded: checklistItem,
        countsCorrect: checklistItem,
        specimensLabelled: checklistItem,
        equipmentProblemsNoted: checklistItem,
      },
    },

    anaesthesia: {
      type: { type: String, enum: ['ga', 'spinal', 'epidural', 'regional', 'local', 'sedation', ''], default: '' },
      asaClass: { type: String, enum: ['I', 'II', 'III', 'IV', 'V', ''], default: '' },
      inductionAt: { type: Date, default: null },
      reversalAt: { type: Date, default: null },
      notes: { type: String, trim: true, default: '' },
    },

    implants: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          catalogueNo: { type: String, trim: true, default: '' },
          lotNo: { type: String, trim: true, default: '' },
          site: { type: String, trim: true, default: '' },
        },
      ],
      default: [],
    },

    findings: { type: String, trim: true, default: '' },
    cancellationReason: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    price: { type: Number, min: 0, default: 0 },
  },
  {
    timestamps: true,
    collection: 'surgeries',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

surgerySchema.plugin(auditable);
surgerySchema.index({ theatre: 1, scheduledStart: 1 });
surgerySchema.index({ patientId: 1, scheduledStart: -1 });

surgerySchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.surgeryNumber) {
    this.surgeryNumber = await nextFormattedId('surgeryNumber', 'OT', 6);
  }
  next();
});

export const Surgery = mongoose.model('Surgery', surgerySchema);
export default Surgery;
