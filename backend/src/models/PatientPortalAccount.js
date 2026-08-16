import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../config/env.js';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/**
 * Login for the patient-facing portal. Separate from staff User so a
 * patient's password never lives on the clinical account table, and so
 * portal tokens cannot be used on /users or billing write routes.
 */
const portalAccountSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'patientPortalAccounts',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.passwordHash; delete ret.__v; return ret; } },
  },
);

portalAccountSchema.plugin(auditable);

portalAccountSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
};

portalAccountSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export const PatientPortalAccount = mongoose.model('PatientPortalAccount', portalAccountSchema);
export default PatientPortalAccount;
