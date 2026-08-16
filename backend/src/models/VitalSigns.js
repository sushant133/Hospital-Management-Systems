import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/** Per-measurement assessment, in the same vocabulary the lab uses for results. */
export const VITAL_FLAGS = ['normal', 'low', 'high', 'critical-low', 'critical-high'];

/**
 * One set of observations, taken at one moment.
 *
 * A separate collection rather than a field on the encounter: vitals are a
 * *series*. An ICU patient has them hourly, and "how has this patient's blood
 * pressure moved over three admissions" is a question about the patient, not
 * about one visit. Both ids are carried so the series
 * can be read either way.
 */
const vitalSignsSchema = new Schema(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Vitals must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'Vitals must reference an encounter'],
      index: true,
    },

    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Vitals must record who took them'],
    },
    recordedAt: { type: Date, default: () => new Date(), index: true },

    // --- Measurements. All optional: a nurse may take only what is asked for. ---
    temperatureC: { type: Number, min: 25, max: 45 },
    pulseBpm: { type: Number, min: 0, max: 300 },
    respiratoryRate: { type: Number, min: 0, max: 120 },
    systolicBp: { type: Number, min: 0, max: 300 },
    diastolicBp: { type: Number, min: 0, max: 200 },
    spo2: { type: Number, min: 0, max: 100 },
    weightKg: { type: Number, min: 0, max: 500 },
    heightCm: { type: Number, min: 0, max: 300 },
    /** 0–10 numeric rating scale. */
    painScore: { type: Number, min: 0, max: 10 },

    /** Derived from weight and height when both are present. */
    bmi: { type: Number, default: null },

    /**
     * Per-measurement flags, computed on save by services/vitalsService.js.
     * Stored rather than derived on read so the timeline can be filtered and
     * sorted on them without recomputing every row.
     */
    flags: {
      type: Map,
      of: { type: String, enum: VITAL_FLAGS },
      default: () => new Map(),
    },
    hasAbnormal: { type: Boolean, default: false, index: true },
    hasCritical: { type: Boolean, default: false, index: true },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'vitalSigns',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

vitalSignsSchema.plugin(auditable);

// The two shapes of the timeline: one visit's observations, and a patient's.
vitalSignsSchema.index({ encounterId: 1, recordedAt: -1 });
vitalSignsSchema.index({ patientId: 1, recordedAt: -1 });

/** At least one measurement — an empty observation set is not a record of anything. */
const MEASUREMENTS = [
  'temperatureC',
  'pulseBpm',
  'respiratoryRate',
  'systolicBp',
  'diastolicBp',
  'spo2',
  'weightKg',
  'heightCm',
  'painScore',
];

vitalSignsSchema.pre('validate', function requireOne(next) {
  const recorded = MEASUREMENTS.some((field) => this[field] !== undefined && this[field] !== null);
  if (!recorded) {
    return next(new Error('Record at least one measurement'));
  }
  return next();
});

/** Blood pressure reads as one value clinically, so expose it as one. */
vitalSignsSchema.virtual('bloodPressure').get(function bloodPressure() {
  if (this.systolicBp === undefined || this.diastolicBp === undefined) return null;
  return `${this.systolicBp}/${this.diastolicBp}`;
});

export { MEASUREMENTS };
export const VitalSigns = mongoose.model('VitalSigns', vitalSignsSchema);
export default VitalSigns;
