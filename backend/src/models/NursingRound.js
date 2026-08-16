import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const MOBILITY_LEVELS = ['independent', 'assisted', 'bed-bound'];
export const CONSCIOUSNESS_LEVELS = ['alert', 'voice', 'pain', 'unresponsive'];
export const RISK_LEVELS = ['low', 'medium', 'high'];

/**
 * A ward round: the periodic check a nurse performs on an admitted patient.
 *
 * Distinct from both observations and notes, which it sits between. Vitals are
 * numbers, a nursing note is prose; a round is the structured checklist of
 * ward care — was the patient repositioned, is the cannula still clean, what is
 * the fall risk now. Recording those as free text makes them unauditable, which
 * is precisely what pressure-area and falls reporting need.
 */
const nursingRoundSchema = new Schema(
  {
    // Patient and encounter are both required.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'A round must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'A round must reference an admission'],
      index: true,
    },
    /** Where the patient was at the time — a stay can move between beds. */
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null },
    bedId: { type: Schema.Types.ObjectId, ref: 'Bed', default: null },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A round must record who performed it'],
    },
    roundAt: { type: Date, default: () => new Date(), index: true },

    // --- The checklist ---
    consciousness: { type: String, enum: CONSCIOUSNESS_LEVELS, default: 'alert' },
    mobility: { type: String, enum: MOBILITY_LEVELS, default: 'independent' },
    painScore: { type: Number, min: 0, max: 10 },

    repositioned: { type: Boolean, default: false },
    pressureAreasChecked: { type: Boolean, default: false },
    hygieneAssisted: { type: Boolean, default: false },
    medicationGiven: { type: Boolean, default: false },
    ivLineChecked: { type: Boolean, default: false },
    catheterChecked: { type: Boolean, default: false },

    /** Millilitres over the shift, where the ward is on a fluid balance chart. */
    intakeMl: { type: Number, min: 0, max: 20000 },
    outputMl: { type: Number, min: 0, max: 20000 },

    fallRisk: { type: String, enum: RISK_LEVELS, default: 'low' },
    /** Anything needing a doctor's attention before the next round. */
    escalated: { type: Boolean, default: false, index: true },
    escalationReason: { type: String, trim: true, default: '' },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'nursingRounds',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

nursingRoundSchema.plugin(auditable);

nursingRoundSchema.index({ encounterId: 1, roundAt: -1 });
nursingRoundSchema.index({ patientId: 1, roundAt: -1 });

/** Escalating without saying why leaves the next nurse guessing. */
nursingRoundSchema.pre('validate', function requireEscalationReason(next) {
  if (this.escalated && !(this.escalationReason ?? '').trim()) {
    return next(new Error('Give a reason when escalating a round'));
  }
  return next();
});

/** Net fluid balance for the round, when both sides were charted. */
nursingRoundSchema.virtual('fluidBalanceMl').get(function fluidBalance() {
  if (this.intakeMl === undefined || this.outputMl === undefined) return null;
  return this.intakeMl - this.outputMl;
});

export const NursingRound = mongoose.model('NursingRound', nursingRoundSchema);
export default NursingRound;
