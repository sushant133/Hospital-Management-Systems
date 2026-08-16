import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/**
 * Narcotic schedules under Nepal's narcotic drugs control regime.
 * `none` is the overwhelming majority of the formulary and costs nothing.
 */
export const DRUG_SCHEDULES = Object.freeze(['none', 'narcotic', 'psychotropic', 'precursor']);

export const REGISTER_ENTRY_TYPES = Object.freeze([
  'receipt', // stock in from pharmacy or supplier
  'administration', // given to a patient
  'wastage', // part-ampoule discarded
  'return', // sent back to pharmacy
  'count-adjustment', // reconciling a discrepancy, always with a reason
  'transfer', // moved between wards
]);

/**
 * ============================================================================
 * CONTROLLED DRUG REGISTER
 * ============================================================================
 *
 * A running, witnessed, inspectable balance of every narcotic and psychotropic
 * held on a ward.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST INVENTORY
 * ---------------------------------------------------------------------------
 * The pharmacy module already tracks stock. It cannot serve here, for reasons
 * that are legal rather than technical:
 *
 *   1. The register is inspectable by the Department of Drug Administration and
 *      must show a RUNNING BALANCE after every single movement — not a current
 *      quantity that can be recomputed. An inspector reads down the column.
 *   2. Every movement needs a WITNESS. Two named people, not one.
 *   3. WASTAGE IS A FIRST-CLASS EVENT. Half an ampoule of morphine discarded is
 *      the single commonest route for diversion, and it must be witnessed and
 *      accounted for exactly like administration.
 *   4. Entries are APPEND-ONLY. A correction is a new adjusting entry with a
 *      reason, never an edit — an alterable narcotic register is worthless as
 *      evidence.
 *
 * `balanceAfter` is stored rather than derived precisely because an inspector
 * compares the written column against the physical count. Recomputing it would
 * silently rewrite history the moment an old entry were ever touched.
 */
const controlledDrugRegisterSchema = new Schema(
  {
    /** Ward-level register: one running balance per drug per location. */
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true, index: true },
    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true, index: true },
    /** Snapshot, so the register still reads correctly if the drug is renamed. */
    drugName: { type: String, required: true, trim: true },
    schedule: { type: String, enum: DRUG_SCHEDULES, required: true, index: true },
    batchNumber: { type: String, trim: true, default: '' },

    entryType: { type: String, enum: REGISTER_ENTRY_TYPES, required: true, index: true },

    /** Positive for receipts, negative for everything that leaves. */
    quantity: { type: Number, required: true },
    unit: { type: String, trim: true, default: 'ampoule' },

    /**
     * The running balance immediately after this entry. Stored, not computed —
     * see the note above.
     */
    balanceAfter: { type: Number, required: true },

    // --- Who, and who watched ---------------------------------------------
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    performedByName: { type: String, trim: true, default: '' },
    /**
     * The second signature. Required for everything except a plain receipt —
     * enforced by a path validator below rather than left to the controller,
     * because a register entry without a witness is not a register entry.
     */
    witnessedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    witnessedByName: { type: String, trim: true, default: '' },

    occurredAt: { type: Date, default: Date.now, required: true, index: true },

    // --- Clinical linkage (administration) --------------------------------
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', default: null },
    administrationId: { type: Schema.Types.ObjectId, ref: 'MedicationAdministration', default: null },

    /** Required for wastage and for any count adjustment. */
    reason: { type: String, trim: true, default: '' },

    /** Set when a physical count did not match the register. */
    discrepancy: {
      expected: { type: Number, default: null },
      counted: { type: Number, default: null },
      investigated: { type: Boolean, default: false },
      investigationNote: { type: String, trim: true, default: '' },
    },
  },
  {
    timestamps: true,
    collection: 'controlledDrugRegister',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

controlledDrugRegisterSchema.plugin(auditable);

/** The register as an inspector reads it: one ward, one drug, in time order. */
controlledDrugRegisterSchema.index({ wardId: 1, drugId: 1, occurredAt: 1 });
controlledDrugRegisterSchema.index({ schedule: 1, occurredAt: -1 });
controlledDrugRegisterSchema.index({ patientId: 1, occurredAt: -1 });
/** Unreconciled discrepancies — the report nobody wants but everyone needs. */
controlledDrugRegisterSchema.index({ 'discrepancy.investigated': 1, occurredAt: -1 });

/**
 * APPEND-ONLY.
 *
 * A narcotic register that can be edited after the fact is worthless as
 * evidence, so the model refuses. Corrections are new `count-adjustment`
 * entries carrying a reason.
 */
/**
 * The one permitted later addition: a discrepancy is found now and explained
 * afterwards. Everything else about an entry is fixed the moment it is written.
 *
 * Prefixes, not exact paths — setting `discrepancy.investigated` also marks the
 * parent `discrepancy` modified, and an exact-match list would reject the very
 * change it was written to allow.
 */
const MUTABLE_AFTER_WRITE = ['discrepancy', 'updatedAt', 'updatedBy'];

controlledDrugRegisterSchema.pre('save', function refuseEdits(next) {
  if (!this.isNew) {
    const changed = this.modifiedPaths().filter(
      (path) => !MUTABLE_AFTER_WRITE.some((allowed) => path === allowed || path.startsWith(`${allowed}.`)),
    );
    if (changed.length > 0) {
      return next(
        new Error(
          `The controlled drug register is append-only; ${changed.join(', ')} cannot be changed. ` +
            'Record a count-adjustment entry with a reason instead.',
        ),
      );
    }
  }
  return next();
});

controlledDrugRegisterSchema.pre('deleteOne', { document: true, query: false }, function refuseDelete(next) {
  next(new Error('Controlled drug register entries cannot be deleted.'));
});

/** Everything but a receipt needs a second signature. */
controlledDrugRegisterSchema.path('witnessedBy').validate(function requireWitness(value) {
  if (this.entryType === 'receipt') return true;
  return Boolean(value);
}, 'A controlled drug movement must be witnessed by a second named person.');

/** Wastage and adjustments must say why. */
controlledDrugRegisterSchema.path('reason').validate(function requireReason(value) {
  if (!['wastage', 'count-adjustment'].includes(this.entryType)) return true;
  return Boolean(value) && value.trim().length >= 5;
}, 'Wastage and count adjustments need a stated reason.');

/** The witness must be a different person. A self-witnessed entry is not one. */
controlledDrugRegisterSchema.path('witnessedBy').validate(function distinctWitness(value) {
  if (!value) return true;
  return String(value) !== String(this.performedBy);
}, 'The witness must be someone other than the person performing the movement.');

export const ControlledDrugRegister = mongoose.model(
  'ControlledDrugRegister',
  controlledDrugRegisterSchema,
);
export default ControlledDrugRegister;
