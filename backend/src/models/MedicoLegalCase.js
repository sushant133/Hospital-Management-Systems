import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFiscalSequence } from '../utils/sequence.js';
import { DISTRICT_CODES } from '../utils/nepal.js';

const { Schema } = mongoose;

/**
 * Presentations that must be registered as medico-legal in Nepal and reported
 * to police. Kept as an explicit list because triage staff need to recognise
 * them, not judge them.
 */
export const MLC_CATEGORIES = Object.freeze([
  'road-traffic-accident',
  'assault',
  'poisoning',
  'burn',
  'suspected-suicide',
  'suspected-homicide',
  'sexual-assault',
  'domestic-violence',
  'industrial-accident',
  'fall-from-height',
  'firearm-injury',
  'animal-bite',
  'drowning',
  'electrocution',
  'custodial-injury',
  'brought-dead',
  'other',
]);

export const MLC_STATUSES = Object.freeze([
  'registered',
  'police-informed',
  'under-investigation',
  'report-issued',
  'closed',
]);

/**
 * ============================================================================
 * MEDICO-LEGAL CASE REGISTER
 * ============================================================================
 *
 * Any hospital in Nepal receiving accident, assault, poisoning, burn or
 * suspected-suicide cases has a legal duty to register them as MLC and inform
 * the police. The record has its own numbering, its own custody rules, and
 * restrictions on who may read or release it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A FIELD ON THE ENCOUNTER
 * ---------------------------------------------------------------------------
 * Three things make it a separate, differently-governed record:
 *
 *   1. It is EVIDENCE. It may be produced in court years later, and every read
 *      of it is itself auditable — the system's `auditRead` middleware exists
 *      largely for this.
 *   2. It has a SEPARATE SEQUENCE, numbered by fiscal year, that must be
 *      unbroken for the same reason an invoice sequence must be.
 *   3. ACCESS IS NARROWER than the clinical record. A ward nurse treats the
 *      patient; they have no business reading the police intimation.
 *
 * ---------------------------------------------------------------------------
 * REGISTRATION IS NOT A CLINICAL JUDGEMENT
 * ---------------------------------------------------------------------------
 * Staff sometimes hesitate to register an MLC because it feels like accusing
 * someone. It is not: the duty attaches to the PRESENTATION, not to a
 * conclusion about what happened. `triageTriggered` records that the system
 * prompted, so a case that should have been registered and was not is visible
 * afterwards rather than invisible.
 */
const medicoLegalCaseSchema = new Schema(
  {
    mlcNumber: { type: String, unique: true, index: true },
    fiscalYear: { type: String, required: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },

    category: { type: String, enum: MLC_CATEGORIES, required: true, index: true },
    categoryNote: { type: String, trim: true, default: '' },

    /** When the incident happened, as distinct from when they reached us. */
    incidentAt: { type: Date, default: null },
    incidentPlace: { type: String, trim: true, default: '' },
    incidentDistrict: { type: String, enum: [...DISTRICT_CODES, ''], default: '' },

    arrivedAt: { type: Date, required: true, default: Date.now, index: true },
    /** Who brought them — police, family, ambulance, a passer-by. */
    broughtBy: { type: String, trim: true, default: '' },
    broughtByContact: { type: String, trim: true, default: '' },

    /** The person who gave the account, and what they said. */
    informantName: { type: String, trim: true, default: '' },
    informantRelation: { type: String, trim: true, default: '' },
    allegedHistory: { type: String, trim: true, default: '' },

    // --- Examination -------------------------------------------------------
    examinedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    examinedAt: { type: Date, default: null },
    /**
     * Injuries, described individually. A single free-text blob is what makes
     * these reports useless in court; each injury needs its own site, size and
     * character.
     */
    injuries: {
      type: [
        new Schema(
          {
            site: { type: String, required: true, trim: true },
            type: { type: String, trim: true, default: '' },
            size: { type: String, trim: true, default: '' },
            description: { type: String, trim: true, default: '' },
            ageOfInjury: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    generalCondition: { type: String, trim: true, default: '' },
    /** Whether the patient was fit to give a statement at the time. */
    conscious: { type: Boolean, default: null },
    smellOfAlcohol: { type: Boolean, default: null },

    // --- Police ------------------------------------------------------------
    /**
     * Informing the police is the legal duty, so the record captures the act
     * itself: which station, whom, and at what time — not merely a checkbox.
     */
    policeStation: { type: String, trim: true, default: '' },
    policeInformedAt: { type: Date, default: null, index: true },
    policeInformedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    policeOfficerName: { type: String, trim: true, default: '' },
    policeOfficerContact: { type: String, trim: true, default: '' },
    firNumber: { type: String, trim: true, default: '' },

    status: { type: String, enum: MLC_STATUSES, default: 'registered', index: true },

    /** True when triage prompted this rather than a human initiating it. */
    triageTriggered: { type: Boolean, default: false },

    /** Specimens taken for toxicology or forensic analysis. */
    specimens: {
      type: [
        new Schema(
          {
            type: { type: String, required: true, trim: true },
            collectedAt: { type: Date, default: Date.now },
            collectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            handedTo: { type: String, trim: true, default: '' },
            sealNumber: { type: String, trim: true, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    reportIssuedAt: { type: Date, default: null },
    reportIssuedTo: { type: String, trim: true, default: '' },
    reportPath: { type: String, trim: true, default: '' },

    closedAt: { type: Date, default: null },
    closureNote: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'medicoLegalCases',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

medicoLegalCaseSchema.plugin(auditable);

medicoLegalCaseSchema.index({ fiscalYear: 1, mlcNumber: 1 });
medicoLegalCaseSchema.index({ category: 1, arrivedAt: -1 });
medicoLegalCaseSchema.index({ patientId: 1, arrivedAt: -1 });
/** Registered but police not yet informed — the duty that is still outstanding. */
medicoLegalCaseSchema.index({ status: 1, policeInformedAt: 1 });

medicoLegalCaseSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.mlcNumber) {
    const { number, fiscalYear } = await nextFiscalSequence('mlc', 'MLC');
    this.mlcNumber = number;
    this.fiscalYear = fiscalYear;
  }
  next();
});

/** Registered, and the police have still not been told. */
medicoLegalCaseSchema.virtual('policeIntimationOverdue').get(function overdue() {
  if (this.policeInformedAt) return false;
  // Informing should be immediate; anything past a few hours is a lapse.
  return Date.now() - new Date(this.arrivedAt).getTime() > 6 * 3600000;
});

export const MedicoLegalCase = mongoose.model('MedicoLegalCase', medicoLegalCaseSchema);
export default MedicoLegalCase;
