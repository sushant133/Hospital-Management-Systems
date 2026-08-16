import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * ============================================================================
 * CLINICAL TERMINOLOGY
 * ============================================================================
 *
 * One collection for every coded vocabulary the system uses: ICD for
 * diagnoses, LOINC for lab observations, SNOMED CT for problems and allergies,
 * ICD-9-CM / ICHI for procedures.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE COLLECTION AND NOT FOUR
 * ---------------------------------------------------------------------------
 * They have identical shape (code, display, parent, status) and identical
 * access patterns (typeahead search, validate a code, walk ancestors). Four
 * near-duplicate collections would mean four search implementations that drift
 * apart, and four places to fix when the next terminology arrives. The `system`
 * discriminator costs one index field.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONTENT IS NOT IN THIS REPOSITORY
 * ---------------------------------------------------------------------------
 * ICD-11, LOINC and SNOMED CT are large, versioned, and separately licensed —
 * SNOMED CT in particular requires a member-country affiliate licence, which
 * Nepal's status for determines what a hospital may load. Shipping any of them
 * would be both a licensing claim we cannot make and a snapshot that goes stale.
 *
 * So the collection is populated by `scripts/importTerminology.js` from the
 * official release files, and `terminologyService` reports honestly when a
 * system has not been loaded rather than silently accepting uncoded data.
 */

export const CODE_SYSTEMS = Object.freeze({
  ICD10: 'icd-10',
  ICD11: 'icd-11',
  LOINC: 'loinc',
  SNOMED: 'snomed-ct',
  ICD9_PROCEDURE: 'icd-9-cm',
  ICHI: 'ichi',
  /** Nepal's own service/package codes, where a national list exists. */
  NEPAL_SERVICE: 'np-service',
});

export const CODE_SYSTEM_VALUES = Object.freeze(Object.values(CODE_SYSTEMS));

export const CODE_SYSTEM_LABELS = Object.freeze({
  [CODE_SYSTEMS.ICD10]: { en: 'ICD-10', ne: 'आईसीडी-१०', use: 'diagnosis' },
  [CODE_SYSTEMS.ICD11]: { en: 'ICD-11', ne: 'आईसीडी-११', use: 'diagnosis' },
  [CODE_SYSTEMS.LOINC]: { en: 'LOINC', ne: 'लोइन्क', use: 'observation' },
  [CODE_SYSTEMS.SNOMED]: { en: 'SNOMED CT', ne: 'स्नोमेड', use: 'problem' },
  [CODE_SYSTEMS.ICD9_PROCEDURE]: { en: 'ICD-9-CM', ne: '', use: 'procedure' },
  [CODE_SYSTEMS.ICHI]: { en: 'ICHI', ne: '', use: 'procedure' },
  [CODE_SYSTEMS.NEPAL_SERVICE]: { en: 'Nepal service code', ne: 'सेवा कोड', use: 'service' },
});

const codeSystemSchema = new Schema(
  {
    system: { type: String, enum: CODE_SYSTEM_VALUES, required: true, index: true },
    /** The release this concept came from — terminologies are versioned. */
    version: { type: String, trim: true, default: '' },

    code: { type: String, required: true, trim: true, index: true },
    display: { type: String, required: true, trim: true },
    displayNe: { type: String, trim: true, default: '' },

    /**
     * Lowercased display plus synonyms, for typeahead. Denormalised because a
     * clinician types three characters and expects results before they finish
     * the word; a regex over `display` cannot use an index.
     */
    searchText: { type: String, default: '', index: true },
    synonyms: { type: [String], default: [] },

    /** Parent code, for walking up to a chapter or block. */
    parent: { type: String, trim: true, default: '', index: true },
    /** Every ancestor, so "all respiratory diagnoses" is one indexed query. */
    ancestors: { type: [String], default: [], index: true },

    /** ICD chapter / LOINC class — how morbidity tables group. */
    chapter: { type: String, trim: true, default: '', index: true },

    /**
     * A leaf is codable; a chapter or block heading is not. ICD explicitly
     * forbids coding to a non-leaf, and a system that allows it produces
     * morbidity returns nobody can compare.
     */
    isLeaf: { type: Boolean, default: true, index: true },
    /** Retired codes stay for historical records but cannot be newly assigned. */
    isSelectable: { type: Boolean, default: true, index: true },

    /** LOINC-specific: what is measured, on what, how. */
    property: { type: String, trim: true, default: '' },
    specimen: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: '' },

    /**
     * Notifiable to EWARS / IDS. Set on the concept rather than looked up in a
     * list at report time, so the alert fires the moment the diagnosis is
     * entered rather than at the end of the week.
     */
    isNotifiable: { type: Boolean, default: false, index: true },
    notifiableWithinHours: { type: Number, default: 24 },

    /** Crosswalk: the equivalent code in another system. */
    mappings: {
      type: [
        new Schema(
          {
            system: { type: String, enum: CODE_SYSTEM_VALUES, required: true },
            code: { type: String, required: true, trim: true },
            equivalence: {
              type: String,
              enum: ['equivalent', 'wider', 'narrower', 'inexact'],
              default: 'equivalent',
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'codeSystems',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

// One concept per code per system per version.
codeSystemSchema.index({ system: 1, code: 1, version: 1 }, { unique: true });
// The typeahead: within a system, selectable leaves matching a prefix.
codeSystemSchema.index({ system: 1, isSelectable: 1, searchText: 1 });
codeSystemSchema.index({ system: 1, chapter: 1 });
// Full-text for multi-word searches ("acute lower respiratory infection").
codeSystemSchema.index({ display: 'text', synonyms: 'text' });

codeSystemSchema.pre('save', function buildSearchText(next) {
  if (this.isModified('display') || this.isModified('synonyms')) {
    this.searchText = [this.display, ...(this.synonyms || [])]
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
  next();
});

export const CodeSystem = mongoose.model('CodeSystem', codeSystemSchema);
export default CodeSystem;

/**
 * A coded concept as it is EMBEDDED on a clinical record.
 *
 * Records carry `{ system, code, display, version }` rather than a reference,
 * and that denormalisation is deliberate. A diagnosis recorded in 2024 must
 * still read the same in 2030 after the terminology is updated and the concept
 * is renamed or retired — the chart states what the clinician actually chose at
 * the time. A join would silently rewrite history.
 */
export const codeableConcept = (options = {}) =>
  new Schema(
    {
      system: { type: String, enum: CODE_SYSTEM_VALUES, required: options.required !== false },
      code: { type: String, required: options.required !== false, trim: true },
      display: { type: String, required: options.required !== false, trim: true },
      /** Terminology release in force when this was recorded. */
      version: { type: String, trim: true, default: '' },
      /** What the clinician typed, when it differs from the concept's display. */
      text: { type: String, trim: true, default: '' },
    },
    { _id: false },
  );
