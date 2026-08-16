import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { codeableConcept } from './CodeSystem.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * INFECTION CONTROL AND ANTIMICROBIAL STEWARDSHIP (B9)
 * ============================================================================
 *
 * Two linked programmes that share their inputs — culture results, device days,
 * and what antibiotics are actually being given.
 *
 * Nepal's antimicrobial resistance burden makes the stewardship half urgent
 * rather than aspirational, and the hospital already holds everything needed to
 * produce its own antibiogram; it simply never did anything with it.
 */

/* ==========================================================================
 * HEALTHCARE-ASSOCIATED INFECTION SURVEILLANCE
 * ======================================================================= */

export const HAI_TYPES = Object.freeze({
  CLABSI: 'clabsi', // central line-associated bloodstream infection
  CAUTI: 'cauti', // catheter-associated urinary tract infection
  VAP: 'vap', // ventilator-associated pneumonia
  SSI: 'ssi', // surgical site infection
  CDIFF: 'c-difficile',
  OTHER: 'other',
});

export const HAI_TYPE_VALUES = Object.freeze(Object.values(HAI_TYPES));

export const DEVICE_TYPES = Object.freeze(['central-line', 'urinary-catheter', 'ventilator', 'peripheral-line', 'drain']);

/**
 * A device in a patient, with the days it stayed in.
 *
 * ---------------------------------------------------------------------------
 * DEVICE DAYS ARE THE DENOMINATOR, AND THAT IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * "Six CLABSIs this quarter" means nothing on its own. The measure is
 * infections per 1,000 central-line days, because a unit running twice the
 * lines will see twice the infections at identical safety. Without the
 * denominator a good ICU looks worse than a lazy one, and the number cannot be
 * compared to anything — including itself last quarter.
 *
 * So insertion and removal are recorded as events, and the denominator falls
 * out of them.
 */
const deviceDaySchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null, index: true },

    deviceType: { type: String, enum: DEVICE_TYPES, required: true, index: true },
    site: { type: String, trim: true, default: '' },

    insertedAt: { type: Date, required: true, index: true },
    insertedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Insertion-bundle compliance, the modifiable half of CLABSI prevention. */
    bundleCompliant: { type: Boolean, default: null },
    bundleNote: { type: String, trim: true, default: '' },

    removedAt: { type: Date, default: null, index: true },
    removedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    removalReason: {
      type: String,
      enum: ['no-longer-needed', 'suspected-infection', 'blocked', 'dislodged', 'death', 'discharge', ''],
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'deviceDays',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

deviceDaySchema.plugin(auditable);
deviceDaySchema.index({ deviceType: 1, insertedAt: 1, removedAt: 1 });
deviceDaySchema.index({ wardId: 1, deviceType: 1, removedAt: 1 });

/** Days in situ — the denominator contribution of this one device. */
deviceDaySchema.virtual('deviceDays').get(function days() {
  const end = this.removedAt ? new Date(this.removedAt) : new Date();
  return Math.max(1, Math.ceil((end - new Date(this.insertedAt)) / 86400000));
});

export const DeviceDay = mongoose.model('DeviceDay', deviceDaySchema);

/** A recognised healthcare-associated infection. */
const haiCaseSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null, index: true },

    haiType: { type: String, enum: HAI_TYPE_VALUES, required: true, index: true },
    deviceDayId: { type: Schema.Types.ObjectId, ref: 'DeviceDay', default: null },
    surgeryId: { type: Schema.Types.ObjectId, ref: 'Surgery', default: null },

    onsetDate: { type: Date, required: true, index: true },
    /**
     * The distinction that decides whether this is OUR infection: present on
     * admission means the patient brought it, and it does not count against the
     * unit. Getting this wrong in either direction corrupts the rate.
     */
    presentOnAdmission: { type: Boolean, default: false },

    organism: { type: String, trim: true, default: '' },
    organismConcept: { type: codeableConcept({ required: false }), default: null },
    labOrderId: { type: Schema.Types.ObjectId, ref: 'LabOrder', default: null },

    /** Culture and sensitivity, which is also what feeds the antibiogram. */
    sensitivities: {
      type: [
        new Schema(
          {
            antibiotic: { type: String, required: true, trim: true },
            result: { type: String, enum: ['sensitive', 'intermediate', 'resistant'], required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Multi-drug resistant — the flag that changes isolation and therapy. */
    isMultiDrugResistant: { type: Boolean, default: false, index: true },

    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    outcome: { type: String, enum: ['resolved', 'ongoing', 'died', ''], default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'haiCases',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

haiCaseSchema.plugin(auditable);
haiCaseSchema.index({ haiType: 1, onsetDate: -1, presentOnAdmission: 1 });
haiCaseSchema.index({ wardId: 1, onsetDate: -1 });

export const HaiCase = mongoose.model('HaiCase', haiCaseSchema);

/* ==========================================================================
 * ISOLATION
 * ======================================================================= */

export const ISOLATION_TYPES = Object.freeze(['contact', 'droplet', 'airborne', 'protective', 'none']);

/**
 * An isolation requirement on a patient.
 *
 * Surfaced on the bed board so nobody assigns a bed blind — placing an MDR
 * patient into an open bay is a decision somebody must take knowingly, and it
 * is currently taken by accident because the information is not on the screen
 * where beds are allocated.
 */
const isolationOrderSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },

    isolationType: { type: String, enum: ISOLATION_TYPES, required: true, index: true },
    reason: { type: String, required: true, trim: true },
    organism: { type: String, trim: true, default: '' },

    startedAt: { type: Date, default: Date.now, required: true },
    orderedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    endedAt: { type: Date, default: null, index: true },
    endedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    endReason: { type: String, trim: true, default: '' },

    /** Precautions in plain words, for the sign on the door. */
    precautions: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'isolationOrders',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

isolationOrderSchema.plugin(auditable);
isolationOrderSchema.index({ patientId: 1, endedAt: 1 });
isolationOrderSchema.index({ endedAt: 1, isolationType: 1 });

export const IsolationOrder = mongoose.model('IsolationOrder', isolationOrderSchema);

/* ==========================================================================
 * ANTIMICROBIAL STEWARDSHIP
 * ======================================================================= */

export const ANTIBIOTIC_TIERS = Object.freeze(['access', 'watch', 'reserve']);
export const APPROVAL_STATUSES = Object.freeze(['requested', 'approved', 'rejected', 'expired', 'auto-approved']);

/**
 * A request to use a restricted antibiotic.
 *
 * WHO's AWaRe classification underlies the tiers: `access` agents are freely
 * used, `watch` need justification, `reserve` are last-line and need
 * authorisation. Restricting everything achieves nothing except teaching people
 * to route around the system, so only the tiers that matter are gated.
 *
 * A culture result is the justification that carries weight, which is why the
 * lab order is linked rather than described.
 */
const antibioticApprovalSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', default: null },

    drugId: { type: Schema.Types.ObjectId, ref: 'Drug', required: true, index: true },
    drugName: { type: String, required: true, trim: true },
    tier: { type: String, enum: ANTIBIOTIC_TIERS, required: true, index: true },

    indication: { type: String, required: true, trim: true },
    /** The culture that justifies it, where one exists. */
    labOrderId: { type: Schema.Types.ObjectId, ref: 'LabOrder', default: null },
    cultureOrganism: { type: String, trim: true, default: '' },
    isEmpirical: { type: Boolean, default: true },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },

    status: { type: String, enum: APPROVAL_STATUSES, default: 'requested', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '' },

    /**
     * Approvals expire. An open-ended authorisation becomes a standing licence,
     * which is exactly the behaviour stewardship exists to stop.
     */
    approvedDays: { type: Number, default: 3, min: 1, max: 30 },
    expiresAt: { type: Date, default: null, index: true },

    /** Was therapy narrowed once sensitivities came back? The real measure. */
    deEscalatedAt: { type: Date, default: null },
    deEscalatedTo: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'antibioticApprovals',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

antibioticApprovalSchema.plugin(auditable);
antibioticApprovalSchema.index({ status: 1, requestedAt: -1 });
antibioticApprovalSchema.index({ status: 1, expiresAt: 1 });

antibioticApprovalSchema.pre('save', function setExpiry(next) {
  if (this.isModified('status') && ['approved', 'auto-approved'].includes(this.status) && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + this.approvedDays * 86400000);
  }
  next();
});

antibioticApprovalSchema.virtual('isExpired').get(function expired() {
  return Boolean(this.expiresAt) && new Date(this.expiresAt) < new Date();
});

export const AntibioticApproval = mongoose.model('AntibioticApproval', antibioticApprovalSchema);

export default { DeviceDay, HaiCase, IsolationOrder, AntibioticApproval };
