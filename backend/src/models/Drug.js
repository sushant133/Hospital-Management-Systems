import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const DRUG_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'suspension',
  'injection',
  'infusion',
  'cream',
  'ointment',
  'drops',
  'inhaler',
  'suppository',
  'patch',
  'other',
];

export const DRUG_ROUTES = [
  'oral',
  'iv',
  'im',
  'sc',
  'topical',
  'inhalation',
  'rectal',
  'ophthalmic',
  'otic',
  'nasal',
  'sublingual',
];

/**
 * The drug master — the formulary, not the stock.
 *
 * One entry per prescribable product: "Amoxicillin 500 mg capsule" is one row,
 * "Amoxicillin 250 mg/5 ml syrup" another, because they are dosed, priced and
 * counted differently. Physical stock lives in `drugBatches`.
 */
const drugSchema = new Schema(
  {
    drugCode: {
      type: String,
      required: [true, 'Drug code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    /** Brand or label name as stocked. */
    name: { type: String, required: [true, 'Drug name is required'], trim: true },
    /** INN / generic name — what the allergy check and substitution reason about. */
    genericName: { type: String, required: [true, 'Generic name is required'], trim: true, index: true },

    form: { type: String, enum: DRUG_FORMS, required: true },
    /** Amount per unit, e.g. '500 mg', '250 mg/5 ml'. */
    strength: { type: String, required: [true, 'Strength is required'], trim: true },
    /** The unit stock is counted in: tablet, ml, vial. */
    unit: { type: String, required: [true, 'Unit is required'], trim: true },
    defaultRoute: { type: String, enum: DRUG_ROUTES, default: 'oral' },

    /** WHO ATC classification, for reporting. */
    atcCode: { type: String, trim: true, uppercase: true, default: '' },
    manufacturer: { type: String, trim: true, default: '' },

    sellingPrice: { type: Number, required: [true, 'Selling price is required'], min: 0 },

    /** Below this total quantity on hand, the drug is flagged for reordering. */
    reorderLevel: { type: Number, min: 0, default: 0 },

    /**
     * Controlled drugs are dispensed under stricter rules. Flagged here so the
     * UI and later regulatory reporting can single them out.
     */
    isControlled: { type: Boolean, default: false, index: true },

    /**
     * Allergen classes this product belongs to, e.g. ['penicillin', 'beta-lactam'].
     *
     * Matched against `patient.medicalHistory.allergies[].substance` at dispense
     * time. Held as a list rather than inferred from the name because a patient
     * allergic to penicillin must be warned about amoxicillin, whose name shares
     * nothing with it.
     */
    allergenClasses: { type: [String], default: [], index: true },

    /** Free-text cautions shown to the prescriber and the pharmacist. */
    cautions: { type: String, trim: true, default: '' },

    /** Daily dose bounds used by the safety check. Null means "not set". */
    minDailyDose: { type: Number, default: null, min: 0 },
    maxDailyDose: { type: Number, default: null, min: 0 },
    doseUnit: { type: String, trim: true, default: 'mg' },

    /* ----------------------------------------------------------------------
     * SAFETY-CHECK INPUTS (B3)
     * ----------------------------------------------------------------------
     * Every field below exists to let `safetyService` refuse a dangerous
     * prescription. All are optional: a formulary entry without them still
     * works, it simply cannot be checked on that dimension — and the service
     * says so rather than implying the drug was cleared.
     */

    /**
     * Weight-based bounds, mg/kg/day. The paediatric dose is almost never a
     * flat number, and the commonest paediatric overdose is arithmetic.
     */
    minDosePerKg: { type: Number, default: null, min: 0 },
    maxDosePerKg: { type: Number, default: null, min: 0 },

    /** Therapeutic classes, for duplicate-therapy detection (two NSAIDs). */
    therapeuticClasses: { type: [String], default: [], index: true },

    /** Cleared by the kidney — triggers the renal check. */
    renallyCleared: { type: Boolean, default: false, index: true },

    /**
     * Dose bands by creatinine clearance (Cockcroft–Gault, mL/min).
     * Bands are half-open [min, max); `contraindicated` blocks outright.
     */
    renalAdjustment: {
      type: [
        new Schema(
          {
            minClearance: { type: Number, default: null },
            maxClearance: { type: Number, default: null },
            recommendation: { type: String, trim: true, default: '' },
            contraindicated: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** A–X. D and X raise a warning; X is a contraindication. */
    pregnancyCategory: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'X', ''],
      default: '',
    },
    lactationRisk: {
      type: String,
      enum: ['safe', 'caution', 'avoid', ''],
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'drugs',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

drugSchema.plugin(auditable);

drugSchema.index({ name: 1 });
drugSchema.index({ genericName: 1, isActive: 1 });

/** Normalise allergen classes so matching is case-insensitive and stable. */
drugSchema.pre('validate', function normaliseAllergens(next) {
  if (Array.isArray(this.allergenClasses)) {
    this.allergenClasses = [
      ...new Set(this.allergenClasses.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)),
    ];
  }
  next();
});

/** Label as it should read on a dispensing bag. */
drugSchema.virtual('label').get(function label() {
  return `${this.name} ${this.strength} ${this.form}`;
});

export const Drug = mongoose.model('Drug', drugSchema);
export default Drug;
