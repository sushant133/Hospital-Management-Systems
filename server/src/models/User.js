import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config, { ROLE_VALUES } from '../config/index.js';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

/**
 * Staff login account. Every role in the system lives in this one collection —
 * role-specific attributes (specialization, licenseNumber) are optional fields
 * rather than separate collections, because a user has exactly one role and the
 * extra fields are few.
 */
const userSchema = new mongoose.Schema(
  {
    employeeId: { type: String, unique: true, index: true },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // select:false — never returned by a query unless explicitly asked for.
    passwordHash: { type: String, required: true, select: false },

    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },
    phone: { type: String, trim: true },

    role: {
      type: String,
      required: true,
      enum: { values: ROLE_VALUES, message: '{VALUE} is not a valid role' },
      index: true,
    },

    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },

    // Clinical staff extras
    specialization: { type: String, trim: true },
    licenseNumber: { type: String, trim: true },

    lastLoginAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },

    /**
     * Bumped on password change / deactivation. Tokens carry the version they
     * were issued with; a mismatch rejects the token, which revokes every
     * outstanding session for this user without a server-side token store.
     */
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'users',
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

userSchema.plugin(auditable);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ lastName: 1, firstName: 1 });

userSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

/** Allocate an employee id on first save. */
userSchema.pre('save', async function assignEmployeeId(next) {
  if (this.isNew && !this.employeeId) {
    this.employeeId = await nextFormattedId('userEmployeeId', 'EMP', 5);
  }
  next();
});

/** Hash a plaintext password with the configured cost factor. */
userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
};

/** Constant-time comparison against the stored hash. */
userSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);
export default User;
