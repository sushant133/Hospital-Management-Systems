import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/**
 * Medical history is EMBEDDED rather than a separate collection: it is always
 * read together with the patient, is bounded in size, and has no independent
 * lifecycle. Per-visit clinical data lives in `encounters`.
 */
const allergySchema = new Schema(
  {
    substance: { type: String, required: true, trim: true },
    reaction: { type: String, trim: true },
    severity: { type: String, enum: ['mild', 'moderate', 'severe'], default: 'moderate' },
    notedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const chronicConditionSchema = new Schema(
  {
    condition: { type: String, required: true, trim: true },
    diagnosedOn: { type: Date },
    status: { type: String, enum: ['active', 'resolved', 'in-remission'], default: 'active' },
    notes: { type: String, trim: true },
  },
  { _id: true },
);

const surgerySchema = new Schema(
  {
    procedure: { type: String, required: true, trim: true },
    performedOn: { type: Date },
    hospital: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: true },
);

const medicationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    dosage: { type: String, trim: true },
    frequency: { type: String, trim: true },
    startedOn: { type: Date },
  },
  { _id: true },
);

const familyHistorySchema = new Schema(
  {
    relation: { type: String, required: true, trim: true },
    condition: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: true },
);

const patientSchema = new Schema(
  {
    mrn: { type: String, unique: true, index: true },

    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },
    dateOfBirth: { type: Date, required: [true, 'Date of birth is required'] },
    gender: { type: String, required: true, enum: ['male', 'female', 'other'] },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'],
      default: 'unknown',
    },
    maritalStatus: {
      type: String,
      enum: ['single', 'married', 'divorced', 'widowed', 'unknown'],
      default: 'unknown',
    },

    phone: { type: String, required: [true, 'Phone number is required'], trim: true, index: true },
    email: { type: String, lowercase: true, trim: true },

    /**
     * Government identifier (national ID, NHS number, Aadhaar…). Optional,
     * because walk-ins and emergencies arrive without one — which is exactly
     * why it is NOT a unique index. It is instead the strongest single signal
     * in the MPI duplicate check (services/mpi.service.js), where a collision
     * is surfaced to a human rather than rejected by the database.
     */
    nationalId: { type: String, trim: true, sparse: true, index: true },

    address: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true, default: '' },
    },

    emergencyContact: {
      name: { type: String, trim: true },
      relationship: { type: String, trim: true },
      phone: { type: String, trim: true },
    },

    insurance: {
      provider: { type: String, trim: true },
      policyNumber: { type: String, trim: true },
      validTill: { type: Date },
    },

    medicalHistory: {
      allergies: { type: [allergySchema], default: [] },
      chronicConditions: { type: [chronicConditionSchema], default: [] },
      pastSurgeries: { type: [surgerySchema], default: [] },
      currentMedications: { type: [medicationSchema], default: [] },
      familyHistory: { type: [familyHistorySchema], default: [] },
      notes: { type: String, trim: true, default: '' },
    },

    status: {
      type: String,
      enum: ['active', 'inactive', 'deceased'],
      default: 'active',
      index: true,
    },

    registeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'patients',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

patientSchema.plugin(auditable);

// Search across name / MRN / phone from the patient list page.
patientSchema.index({ firstName: 'text', lastName: 'text', mrn: 'text', phone: 'text' });
patientSchema.index({ lastName: 1, firstName: 1 });
patientSchema.index({ isActive: 1, createdAt: -1 });

patientSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

/** Age in whole years, computed from dateOfBirth. */
patientSchema.virtual('age').get(function age() {
  if (!this.dateOfBirth) return null;
  const dob = new Date(this.dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) years -= 1;
  return years >= 0 ? years : null;
});

patientSchema.pre('save', async function assignMrn(next) {
  if (this.isNew && !this.mrn) {
    this.mrn = await nextFormattedId('patientMrn', 'MRN', 6);
  }
  next();
});

export const Patient = mongoose.model('Patient', patientSchema);
export default Patient;
