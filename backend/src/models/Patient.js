import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import {
  ID_TYPE_VALUES,
  DISTRICT_CODES,
  PROVINCE_CODES,
  DISABILITY_CATEGORIES,
  MAX_WARD_NO,
  normaliseIdValue,
  nameMatchKey,
  nameSkeletonKey,
  normalisePhone,
  estimateDobFromAge,
  AGE_UNITS,
} from '../utils/nepal.js';

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

/**
 * One identity document. A Nepali patient may hold several — or none.
 *
 * `issuingDistrict` is not decoration: citizenship and birth-certificate
 * numbers are issued per district, so "12345/678" from Kaski and the same
 * number from Jhapa belong to two different people. The pair is the identity,
 * and `matchKey` stores the folded composite the MPI actually searches on.
 */
const identifierSchema = new Schema(
  {
    type: { type: String, enum: ID_TYPE_VALUES, required: true },
    value: { type: String, required: true, trim: true },
    /** Required for citizenship and birth certificates; see identifiers.js. */
    issuingDistrict: { type: String, enum: [...DISTRICT_CODES, null], default: null },
    issuedOn: { type: Date, default: null },
    /** Disability card category (ka/kha/ga/gha) drives free-care entitlement. */
    category: {
      type: String,
      enum: [...Object.values(DISABILITY_CATEGORIES), null],
      default: null,
    },
    /** Derived on save — never set by hand. See `compositeKey` in nepal.js. */
    matchKey: { type: String, default: '', index: true },
  },
  { _id: true },
);

/**
 * A Nepali address.
 *
 * Province → District → Local level → Ward, which is the shape every statutory
 * return, insurance catchment and referral pathway is keyed on. The local level
 * is stored as both a code (for aggregation) and a name snapshot (so a bill
 * printed today still reads correctly after a palika is renamed).
 */
const addressSchema = new Schema(
  {
    provinceCode: { type: String, enum: [...PROVINCE_CODES, ''], default: '' },
    districtCode: { type: String, enum: [...DISTRICT_CODES, ''], default: '', index: true },
    localLevelCode: { type: String, trim: true, default: '', index: true },
    /** Denormalised on purpose — see above. */
    localLevelName: { type: String, trim: true, default: '' },
    wardNo: { type: Number, min: 1, max: MAX_WARD_NO, default: null },
    /** The last mile: street, tole, house number. Free text by nature. */
    tole: { type: String, trim: true, default: '' },
    /** Only for patients who live outside Nepal. */
    foreignAddress: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'NP' },
  },
  { _id: false },
);

const patientSchema = new Schema(
  {
    mrn: { type: String, unique: true, index: true },

    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },

    /**
     * The same name in Devanagari. Patients give it either way and clerks
     * romanise inconsistently, so both are kept and both feed the match keys.
     */
    firstNameNe: { type: String, trim: true, default: '' },
    lastNameNe: { type: String, trim: true, default: '' },

    /**
     * Script- and spelling-folded name keys, maintained by a pre-save hook.
     * `skeletonKey` (consonants only) narrows MPI candidates; `matchKey` (vowels
     * retained) scores them. Indexed because every registration runs a lookup.
     */
    nameMatchKey: { type: String, default: '', index: true },
    nameSkeletonKey: { type: String, default: '', index: true },

    /**
     * ---------------------------------------------------------------------
     * DATE OF BIRTH IS OPTIONAL, AND THAT IS DELIBERATE
     * ---------------------------------------------------------------------
     * A large share of adult and elderly Nepali patients do not know their date
     * of birth; they state an age. Making DOB required does not produce the
     * information — it produces 01-01-1960 typed a thousand times, which puts a
     * false fact on the chart and poisons the MPI, because every such patient
     * then shares a birthday.
     *
     * So: record what the patient actually said in `statedAge`, derive an
     * approximate `dateOfBirth` from it, and flag it with `dobIsEstimated` so
     * the MPI down-weights it and the UI renders "~65 years" rather than a
     * birthday nobody celebrates.
     */
    dateOfBirth: { type: Date, default: null },
    dobIsEstimated: { type: Boolean, default: false },
    statedAge: {
      value: { type: Number, min: 0, default: null },
      unit: { type: String, enum: [...AGE_UNITS, null], default: null },
      /** When the age was stated — the anchor the estimate was made against. */
      asOf: { type: Date, default: null },
    },
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
     * Every identity document the patient holds.
     *
     * Replaces the old single `nationalId` string. None of these is a unique
     * index: walk-ins and emergencies arrive without papers, and a collision is
     * a question for a human (the MPI surfaces it) rather than something the
     * database should refuse. `identifiers.matchKey` is indexed so the duplicate
     * check can narrow candidates on an exact document hit.
     */
    identifiers: { type: [identifierSchema], default: [] },

    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null, index: true },

    address: { type: addressSchema, default: () => ({}) },

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

    /**
     * Clinical flags that change prescribing.
     *
     * Held on the patient rather than derived from a maternity case, because
     * the safety check runs on every prescription including for women with no
     * maternity record open, and "no record" must not read as "not pregnant".
     */
    flags: {
      isPregnant: { type: Boolean, default: false },
      isBreastfeeding: { type: Boolean, default: false },
      flagsUpdatedAt: { type: Date, default: null },
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
      enum: ['active', 'inactive', 'deceased', 'merged'],
      default: 'active',
      index: true,
    },

    /**
     * When this chart was absorbed into another. The losing record stays so
     * historical MRNs still resolve; every clinical/financial child is
     * re-pointed at `mergedInto`.
     */
    mergedInto: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    mergedFrom: { type: [Schema.Types.ObjectId], ref: 'Patient', default: [] },
    mergedAt: { type: Date, default: null },
    mergedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    mergeReason: { type: String, trim: true, default: '' },

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

// Search across name / MRN / phone from the patient list page. Devanagari names
// are included so a clerk can search in the script the patient gave.
patientSchema.index({
  firstName: 'text',
  lastName: 'text',
  firstNameNe: 'text',
  lastNameNe: 'text',
  mrn: 'text',
  phone: 'text',
});
patientSchema.index({ lastName: 1, firstName: 1 });
patientSchema.index({ isActive: 1, createdAt: -1 });
// The MPI's candidate-narrowing query: skeleton key within a district.
patientSchema.index({ nameSkeletonKey: 1, 'address.districtCode': 1 });

patientSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

patientSchema.virtual('fullNameNe').get(function fullNameNe() {
  return [this.firstNameNe, this.lastNameNe].filter(Boolean).join(' ');
});

/**
 * Age in whole years.
 *
 * Reads from `dateOfBirth` whether that date was given or estimated — the
 * arithmetic is the same. What differs is how it should be *rendered*, which is
 * why `dobIsEstimated` travels alongside; see `formatAge` in utils/nepal.js.
 */
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

/**
 * Maintain every derived field in one place.
 *
 * Match keys, the estimated DOB, the normalised phone and identifier keys are
 * all functions of what the user typed. Deriving them in the controller would
 * mean every write path has to remember — and the import script, the merge
 * service and the portal would each forget differently.
 */
patientSchema.pre('save', function deriveSearchFields(next) {
  if (this.isModified('firstName') || this.isModified('lastName') ||
      this.isModified('firstNameNe') || this.isModified('lastNameNe')) {
    // Prefer the Devanagari spelling when present: it is what the patient
    // actually gave, and the romanisation is the lossy copy.
    const first = this.firstNameNe || this.firstName || '';
    const last = this.lastNameNe || this.lastName || '';
    this.nameMatchKey = `${nameMatchKey(first)} ${nameMatchKey(last)}`.trim();
    this.nameSkeletonKey = `${nameSkeletonKey(first)} ${nameSkeletonKey(last)}`.trim();
  }

  if (this.isModified('phone')) {
    this.phone = normalisePhone(this.phone) || this.phone;
  }

  // An age was stated but no birthday given — derive one and mark it estimated.
  if (this.isModified('statedAge') && this.statedAge?.value != null) {
    const asOf = this.statedAge.asOf || new Date();
    this.statedAge.asOf = asOf;
    this.dateOfBirth = estimateDobFromAge(this.statedAge.value, this.statedAge.unit || 'years', asOf);
    this.dobIsEstimated = true;
  }

  if (this.isModified('identifiers')) {
    for (const identifier of this.identifiers) {
      identifier.value = normaliseIdValue(identifier.value);
      const district = identifier.issuingDistrict;
      identifier.matchKey = district
        ? `${identifier.type}:${district}:${identifier.value}`
        : `${identifier.type}:${identifier.value}`;
    }
  }

  next();
});

/**
 * A patient must be age-identifiable by *something*.
 *
 * Neither a birthday nor a stated age alone is required, but having neither
 * means the chart cannot be matched, aged or dosed. Expressed as a path
 * validator rather than a `pre('validate')` hook deliberately: hooks are
 * skipped by `validateSync()`, so a rule written that way silently does not
 * apply on every path that reaches the database.
 */
patientSchema.path('dateOfBirth').validate(function requireSomeAge(value) {
  return Boolean(value) || this.statedAge?.value != null;
}, 'Give either a date of birth or a stated age — a patient record needs one of them.');

export const Patient = mongoose.model('Patient', patientSchema);
export default Patient;
