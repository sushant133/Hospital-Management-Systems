import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const ENCOUNTER_TYPES = ['opd', 'ipd', 'emergency', 'daycare'];
export const ENCOUNTER_STATUSES = ['open', 'admitted', 'discharged', 'cancelled'];

const diagnosisSchema = new Schema(
  {
    code: { type: String, trim: true },
    description: { type: String, required: true, trim: true },
    type: { type: String, enum: ['primary', 'secondary', 'provisional'], default: 'primary' },
  },
  { _id: true },
);

const vitalsSchema = new Schema(
  {
    temperatureC: { type: Number, min: 25, max: 45 },
    pulseBpm: { type: Number, min: 0, max: 300 },
    respiratoryRate: { type: Number, min: 0, max: 120 },
    systolicBp: { type: Number, min: 0, max: 300 },
    diastolicBp: { type: Number, min: 0, max: 200 },
    spo2: { type: Number, min: 0, max: 100 },
    weightKg: { type: Number, min: 0, max: 500 },
    heightCm: { type: Number, min: 0, max: 300 },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * The clinical spine of the system. Every downstream artifact (lab order,
 * prescription, invoice line) references BOTH patientId and encounterId — see
 * ARCHITECTURE.md §3.
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
    vitals: { type: vitalsSchema, default: undefined },

    admission: {
      wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null },
      bedId: { type: Schema.Types.ObjectId, ref: 'Bed', default: null },
      admittedAt: { type: Date, default: null },
      dischargedAt: { type: Date, default: null },
      dischargeSummary: { type: String, trim: true, default: '' },
      dischargeType: {
        type: String,
        enum: ['recovered', 'referred', 'lama', 'transferred', 'deceased', null],
        default: null,
      },
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
