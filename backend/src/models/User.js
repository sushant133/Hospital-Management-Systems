import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config, { ROLE_VALUES } from '../config/env.js';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { ROLES } from '../config/roles.js';

/**
 * The four professional councils that register clinical staff in Nepal.
 * The registration number issued by one of these is what makes a prescription
 * or a signed report legally valid.
 */
export const COUNCILS = Object.freeze({
  NMC: 'nmc', // Nepal Medical Council — doctors
  NNC: 'nnc', // Nepal Nursing Council — nurses
  NHPC: 'nhpc', // Nepal Health Professional Council — lab, radiography, paramedics
  NPC: 'npc', // Nepal Pharmacy Council — pharmacists
});

export const COUNCIL_VALUES = Object.freeze(Object.values(COUNCILS));

export const COUNCIL_LABELS = Object.freeze({
  [COUNCILS.NMC]: { en: 'Nepal Medical Council', ne: 'नेपाल चिकित्सक परिषद्', abbr: 'NMC' },
  [COUNCILS.NNC]: { en: 'Nepal Nursing Council', ne: 'नेपाल नर्सिङ परिषद्', abbr: 'NNC' },
  [COUNCILS.NHPC]: {
    en: 'Nepal Health Professional Council',
    ne: 'नेपाल स्वास्थ्य व्यवसायी परिषद्',
    abbr: 'NHPC',
  },
  [COUNCILS.NPC]: { en: 'Nepal Pharmacy Council', ne: 'नेपाल फार्मेसी परिषद्', abbr: 'NPC' },
});

/**
 * Which council each clinical role must be registered with.
 * Roles absent from this map (receptionist, accountant, admin) sign nothing
 * clinical and need no registration.
 */
export const COUNCIL_FOR_ROLE = Object.freeze({
  [ROLES.DOCTOR]: COUNCILS.NMC,
  [ROLES.NURSE]: COUNCILS.NNC,
  [ROLES.LAB_TECH]: COUNCILS.NHPC,
  [ROLES.RADIOLOGIST]: COUNCILS.NMC,
  [ROLES.PHARMACIST]: COUNCILS.NPC,
});

/** Roles whose signature carries a council number on printed documents. */
export const REGISTERED_ROLES = Object.freeze(Object.keys(COUNCIL_FOR_ROLE));

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
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', default: null, index: true },

    // Clinical staff extras
    specialization: { type: String, trim: true },
    /** Qualifications as they should print on a report: "MBBS, MD (Medicine)". */
    qualifications: { type: String, trim: true, default: '' },
    licenseNumber: { type: String, trim: true },

    /**
     * -----------------------------------------------------------------------
     * PROFESSIONAL COUNCIL REGISTRATION
     * -----------------------------------------------------------------------
     * In Nepal a prescription, a lab report and a radiology report must carry
     * the issuing professional's council registration number. Without it the
     * document is not valid, so this is not optional metadata — it is printed
     * in the signature block of everything clinical this person signs, and an
     * expired registration blocks new prescriptions (see `hasValidRegistration`).
     *
     * Four councils cover the clinical roles: NMC (doctors), NNC (nurses),
     * NHPC (health professionals — lab, radiography, paramedics) and NPC
     * (pharmacists).
     */
    councilRegistration: {
      council: {
        type: String,
        enum: [...COUNCIL_VALUES, null],
        default: null,
      },
      number: { type: String, trim: true, default: '' },
      registeredOn: { type: Date, default: null },
      /** Councils renew periodically; a lapsed registration must not sign. */
      validTill: { type: Date, default: null },
    },

    /** Also printed on Nepali documents beside the council number. */
    nameNe: { type: String, trim: true, default: '' },

    lastLoginAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },

    /** Consecutive failed passwords. Reset on a successful sign-in. */
    failedLoginCount: { type: Number, default: 0, min: 0 },
    /** While in the future, login is refused before the password is checked. */
    lockedUntil: { type: Date, default: null },

    /**
     * Bumped on password change / deactivation. Tokens carry the version they
     * were issued with; a mismatch rejects the token, which revokes every
     * outstanding session for this user without a server-side token store.
     */
    tokenVersion: { type: Number, default: 0 },

    /* --------------------------------------------------------------------
     * MULTI-FACTOR AUTHENTICATION (D3)
     * --------------------------------------------------------------------
     * The secret is `select: false` for the same reason as the password hash:
     * a query that forgets to exclude it must not leak the one thing that
     * makes the second factor a second factor.
     */
    mfa: {
      enabled: { type: Boolean, default: false, index: true },
      secret: { type: String, default: '', select: false },
      enrolledAt: { type: Date, default: null },
      /**
       * Hashed single-use recovery codes. A clinician locked out at 2am by a
       * lost phone is a patient-safety problem, not an inconvenience — but the
       * database must not hold a usable bypass in plaintext.
       */
      recoveryCodes: { type: [String], default: [], select: false },
      recoveryCodesRemaining: { type: Number, default: 0 },
      lastUsedAt: { type: Date, default: null },
    },
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

/**
 * The signature block for a prescription, lab report or radiology report:
 * name, qualifications, and the council registration that makes it valid.
 * Returns null for roles that sign nothing clinical.
 */
userSchema.virtual('signatureBlock').get(function signatureBlock() {
  if (!REGISTERED_ROLES.includes(this.role)) return null;
  const council = this.councilRegistration?.council;
  return {
    name: [this.firstName, this.lastName].filter(Boolean).join(' '),
    nameNe: this.nameNe || '',
    qualifications: this.qualifications || '',
    council: council ? COUNCIL_LABELS[council].abbr : '',
    councilNe: council ? COUNCIL_LABELS[council].ne : '',
    number: this.councilRegistration?.number || '',
    valid: this.hasValidRegistration(),
  };
});

/**
 * Whether this person may currently sign clinical documents.
 *
 * A missing number and an expired one are both disqualifying: printing a
 * prescription with a lapsed NMC number is worse than printing none, because
 * it asserts something untrue on a legal document.
 */
userSchema.methods.hasValidRegistration = function hasValidRegistration(asOf = new Date()) {
  if (!REGISTERED_ROLES.includes(this.role)) return true; // nothing to register
  const registration = this.councilRegistration;
  if (!registration?.council || !registration?.number) return false;
  if (registration.validTill && new Date(registration.validTill) < asOf) return false;
  return true;
};

/** Days until the registration lapses; null when there is no expiry recorded. */
userSchema.methods.registrationDaysRemaining = function registrationDaysRemaining(asOf = new Date()) {
  const validTill = this.councilRegistration?.validTill;
  if (!validTill) return null;
  return Math.ceil((new Date(validTill) - asOf) / 86400000);
};

/**
 * A clinical role must be registered with the *right* council — an NNC number
 * on a doctor's account is a data-entry error, and it would then print on every
 * prescription they sign.
 *
 * A path validator, not a `pre('validate')` hook: hooks do not run under
 * `validateSync()`, so the rule would apply on some write paths and not others.
 */
userSchema.path('councilRegistration.council').validate({
  validator: function councilMatchesRole(value) {
    const expected = COUNCIL_FOR_ROLE[this.role];
    return !expected || !value || value === expected;
  },
  // A plain message, not a function: Mongoose calls the message callback with a
  // props object rather than the document, so `this.role` is not available there.
  message: ({ value }) =>
    `${COUNCIL_LABELS[value]?.abbr || value} is not the council this role registers with.`,
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
