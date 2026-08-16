import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

export const MACHINE_STATUSES = Object.freeze(['available', 'in-use', 'disinfecting', 'maintenance', 'retired']);

export const VASCULAR_ACCESS = Object.freeze(['av-fistula', 'av-graft', 'tunnelled-catheter', 'temporary-catheter']);

export const SESSION_STATUSES = Object.freeze([
  'scheduled',
  'in-progress',
  'completed',
  'terminated-early',
  'missed',
  'cancelled',
]);

/**
 * ============================================================================
 * DIALYSIS UNIT (C4)
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * WHY DIALYSIS NEEDS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 * It fits neither OPD nor IPD. A patient attends two or three times a week
 * indefinitely, occupies a machine for four hours, and generates a clinical
 * record each time that is nothing like a consultation. Forcing it through the
 * encounter model would create thousands of one-line OPD visits and lose every
 * measure that matters.
 *
 * It is also government-funded and free to citizens in Nepal, which makes it
 * high-volume, scheme-billed (A7's `free-dialysis`) and separately reported.
 * The hospital claims per session against a published rate, so a session that
 * is not recorded is a session that is not paid for.
 */
const dialysisMachineSchema = new Schema(
  {
    machineCode: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    manufacturer: { type: String, trim: true, default: '' },
    model: { type: String, trim: true, default: '' },
    serialNumber: { type: String, trim: true, default: '' },

    status: { type: String, enum: MACHINE_STATUSES, default: 'available', index: true },
    bayNumber: { type: String, trim: true, default: '' },

    /**
     * A machine is dedicated to one serology group. Running a hepatitis-B
     * positive patient on a general machine is a cross-infection event, so the
     * scheduler must never place them together.
     */
    dedicatedTo: {
      type: String,
      enum: ['general', 'hepatitis-b', 'hepatitis-c', 'hiv'],
      default: 'general',
      index: true,
    },

    commissionedOn: { type: Date, default: null },
    lastServicedAt: { type: Date, default: null },
    nextServiceDue: { type: Date, default: null, index: true },
    totalHoursRun: { type: Number, default: 0, min: 0 },

    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
  },
  {
    timestamps: true,
    collection: 'dialysisMachines',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

dialysisMachineSchema.plugin(auditable);
dialysisMachineSchema.index({ status: 1, dedicatedTo: 1 });

export const DialysisMachine = mongoose.model('DialysisMachine', dialysisMachineSchema);

const dialysisSessionSchema = new Schema(
  {
    sessionNumber: { type: String, unique: true, index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    machineId: { type: Schema.Types.ObjectId, ref: 'DialysisMachine', default: null, index: true },

    scheduledFor: { type: Date, required: true, index: true },
    status: { type: String, enum: SESSION_STATUSES, default: 'scheduled', index: true },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    /** Prescribed duration, against which early termination is measured. */
    prescribedMinutes: { type: Number, default: 240, min: 0 },

    // --- The session record ------------------------------------------------
    /**
     * Pre and post weight are the core measurement: the difference IS the fluid
     * removed, and it is how the prescription is judged. Recorded as two
     * numbers rather than one delta so an implausible pair is visible.
     */
    preWeightKg: { type: Number, default: null, min: 0 },
    postWeightKg: { type: Number, default: null, min: 0 },
    dryWeightKg: { type: Number, default: null, min: 0 },
    ultrafiltrationTargetMl: { type: Number, default: null, min: 0 },
    ultrafiltrationAchievedMl: { type: Number, default: null, min: 0 },

    vascularAccess: { type: String, enum: [...VASCULAR_ACCESS, ''], default: '' },
    accessSite: { type: String, trim: true, default: '' },
    accessProblem: { type: String, trim: true, default: '' },

    bloodFlowRate: { type: Number, default: null },
    dialysateFlowRate: { type: Number, default: null },

    /**
     * Dialyser reuse count. Reuse is common and legitimate, and it is also
     * capped — a dialyser past its reuse limit is a clinical hazard, so the
     * count travels on the session rather than living in someone's notebook.
     */
    dialyserType: { type: String, trim: true, default: '' },
    dialyserReuseCount: { type: Number, default: 0, min: 0 },
    dialyserMaxReuse: { type: Number, default: null, min: 0 },

    anticoagulant: { type: String, trim: true, default: '' },
    heparinBolusUnits: { type: Number, default: null, min: 0 },
    heparinHourlyUnits: { type: Number, default: null, min: 0 },

    /** Vitals through the run — hypotension mid-session is the usual event. */
    observations: {
      type: [
        new Schema(
          {
            atMinutes: { type: Number, required: true, min: 0 },
            systolic: { type: Number, default: null },
            diastolic: { type: Number, default: null },
            pulse: { type: Number, default: null },
            ultrafiltrationSoFarMl: { type: Number, default: null },
            note: { type: String, trim: true, default: '' },
            recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            recordedAt: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    /** Intra-session events: cramps, hypotension, clotting, machine alarm. */
    complications: { type: [String], default: [] },
    terminatedEarlyReason: { type: String, trim: true, default: '' },

    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    supervisedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, default: '' },

    // --- Money -------------------------------------------------------------
    /**
     * Almost always billed to the government free-dialysis programme rather
     * than to the patient. `schemeClaimId` is what turns a delivered session
     * into a reimbursable one.
     */
    schemeClaimId: { type: Schema.Types.ObjectId, ref: 'SchemeClaim', default: null },
    billingLineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem', default: null },
    consumablesIssued: {
      type: [
        new Schema(
          {
            inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem' },
            description: { type: String, trim: true },
            quantity: { type: Number, default: 1, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'dialysisSessions',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

dialysisSessionSchema.plugin(auditable);
dialysisSessionSchema.index({ patientId: 1, scheduledFor: -1 });
dialysisSessionSchema.index({ scheduledFor: 1, status: 1 });
dialysisSessionSchema.index({ machineId: 1, scheduledFor: 1 });
/** Sessions delivered but never claimed — money the hospital is owed. */
dialysisSessionSchema.index({ status: 1, schemeClaimId: 1 });

dialysisSessionSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.sessionNumber) {
    this.sessionNumber = await nextFormattedId('dialysisSession', 'HD', 7);
  }
  // Fluid removed is the weight difference; deriving it stops the two from
  // ever disagreeing on the chart.
  if (this.preWeightKg != null && this.postWeightKg != null && this.ultrafiltrationAchievedMl == null) {
    this.ultrafiltrationAchievedMl = Math.max(0, Math.round((this.preWeightKg - this.postWeightKg) * 1000));
  }
  next();
});

/** Actual minutes on the machine, against what was prescribed. */
dialysisSessionSchema.virtual('actualMinutes').get(function minutes() {
  if (!this.startedAt || !this.endedAt) return null;
  return Math.round((new Date(this.endedAt) - new Date(this.startedAt)) / 60000);
});

/** Cut short by more than 15 minutes — an adequacy problem worth seeing. */
dialysisSessionSchema.virtual('wasShortened').get(function shortened() {
  const actual = this.actualMinutes;
  if (actual === null || !this.prescribedMinutes) return false;
  return actual < this.prescribedMinutes - 15;
});

/** Past its reuse limit — a hazard the unit must not repeat. */
dialysisSessionSchema.virtual('dialyserOverReused').get(function over() {
  if (this.dialyserMaxReuse == null) return false;
  return this.dialyserReuseCount > this.dialyserMaxReuse;
});

export const DialysisSession = mongoose.model('DialysisSession', dialysisSessionSchema);

export default { DialysisMachine, DialysisSession };
