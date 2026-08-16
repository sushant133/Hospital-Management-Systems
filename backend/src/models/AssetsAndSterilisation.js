import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * CSSD (C7) AND BIOMEDICAL ASSETS (C8)
 * ============================================================================
 */

/* ==========================================================================
 * C7 — INSTRUMENT SETS AND STERILISATION
 * ======================================================================= */

export const SET_STATUSES = Object.freeze([
  'sterile',
  'issued',
  'in-use',
  'returned-dirty',
  'being-processed',
  'quarantined', // a failed indicator holds everything in that load
  'condemned',
]);

export const CYCLE_TYPES = Object.freeze(['steam-autoclave', 'ethylene-oxide', 'plasma', 'dry-heat', 'chemical']);

export const INDICATOR_RESULTS = Object.freeze(['pass', 'fail', 'pending', 'not-done']);

/**
 * A sterilisation load.
 *
 * ---------------------------------------------------------------------------
 * TRACEABILITY IS THE ENTIRE POINT
 * ---------------------------------------------------------------------------
 * After a surgical site infection the first question is "what else went through
 * that autoclave load?". Without a link from load → set → surgery → patient,
 * that question is unanswerable and the only safe response is to recall
 * everything, which nobody does.
 *
 * The biological indicator is the one that actually proves sterility — physical
 * and chemical indicators only show the cycle ran, not that it killed anything.
 * A biological failure quarantines the whole load, and that must be automatic
 * rather than depending on someone connecting the result to the sets.
 */
const sterilisationCycleSchema = new Schema(
  {
    cycleNumber: { type: String, unique: true, index: true },

    autoclaveId: { type: String, required: true, trim: true, index: true },
    cycleType: { type: String, enum: CYCLE_TYPES, required: true },

    startedAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },

    /** Cycle parameters, as the printout records them. */
    temperatureC: { type: Number, default: null },
    pressureBar: { type: Number, default: null },
    holdMinutes: { type: Number, default: null },

    /** Runs but proves nothing about sterility on its own. */
    physicalIndicator: { type: String, enum: INDICATOR_RESULTS, default: 'not-done' },
    chemicalIndicator: { type: String, enum: INDICATOR_RESULTS, default: 'not-done' },
    /** The one that proves it. A fail quarantines the load. */
    biologicalIndicator: { type: String, enum: INDICATOR_RESULTS, default: 'pending', index: true },
    biologicalReadAt: { type: Date, default: null },
    biologicalReadBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    operatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    loadContents: { type: [String], default: [] },

    status: {
      type: String,
      enum: ['running', 'released', 'quarantined', 'failed'],
      default: 'running',
      index: true,
    },
    quarantineReason: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'sterilisationCycles',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

sterilisationCycleSchema.plugin(auditable);
sterilisationCycleSchema.index({ autoclaveId: 1, startedAt: -1 });
sterilisationCycleSchema.index({ biologicalIndicator: 1, status: 1 });

sterilisationCycleSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.cycleNumber) {
    this.cycleNumber = await nextFormattedId('sterilisationCycle', 'CYC', 7);
  }
  // A biological failure quarantines the load automatically. Leaving this to a
  // human is how contaminated sets reach a theatre.
  if (this.isModified('biologicalIndicator') && this.biologicalIndicator === 'fail') {
    this.status = 'quarantined';
    this.quarantineReason = this.quarantineReason || 'Biological indicator failed.';
  }
  next();
});

export const SterilisationCycle = mongoose.model('SterilisationCycle', sterilisationCycleSchema);

const instrumentSetSchema = new Schema(
  {
    setCode: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    setType: { type: String, trim: true, default: '' },

    /** The checklist a nurse counts against before and after a case. */
    contents: {
      type: [
        new Schema(
          {
            instrument: { type: String, required: true, trim: true },
            quantity: { type: Number, required: true, min: 1 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    status: { type: String, enum: SET_STATUSES, default: 'sterile', index: true },
    location: { type: String, trim: true, default: 'cssd' },

    /** The load that sterilised it — the traceability link. */
    lastCycleId: { type: Schema.Types.ObjectId, ref: 'SterilisationCycle', default: null, index: true },
    sterilisedAt: { type: Date, default: null },
    /** Sterility is time-limited even unopened. */
    sterileUntil: { type: Date, default: null, index: true },

    issuedToTheatre: { type: String, trim: true, default: '' },
    issuedAt: { type: Date, default: null },
    /** Which case used it — closes the loop back to a patient. */
    surgeryId: { type: Schema.Types.ObjectId, ref: 'Surgery', default: null, index: true },

    usageCount: { type: Number, default: 0, min: 0 },
    condemnedAt: { type: Date, default: null },
    condemnedReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'instrumentSets',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

instrumentSetSchema.plugin(auditable);
instrumentSetSchema.index({ status: 1, sterileUntil: 1 });

/** Past its sterility date — must not go to theatre. */
instrumentSetSchema.virtual('isExpired').get(function expired() {
  if (this.status !== 'sterile' || !this.sterileUntil) return false;
  return new Date(this.sterileUntil) < new Date();
});

export const InstrumentSet = mongoose.model('InstrumentSet', instrumentSetSchema);

/* ==========================================================================
 * C8 — BIOMEDICAL ASSETS
 * ======================================================================= */

export const ASSET_STATUSES = Object.freeze([
  'in-service',
  'standby',
  'under-repair',
  'awaiting-parts',
  'condemned',
  'disposed',
]);

export const MAINTENANCE_TYPES = Object.freeze(['preventive', 'corrective', 'calibration', 'inspection']);

/**
 * An asset register.
 *
 * ---------------------------------------------------------------------------
 * NOT THE SAME AS THE `Device` MODEL
 * ---------------------------------------------------------------------------
 * `Device` exists to route HL7 messages from analysers — it answers "which
 * machine sent this result". It is an interface endpoint, not an asset. This
 * answers "what do we own, what is it worth, when was it last serviced, and why
 * was the CT unavailable on Tuesday" — a completely different question with a
 * different lifecycle. `deviceId` links them where a machine is both.
 */
const assetSchema = new Schema(
  {
    assetTag: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: '', index: true },

    manufacturer: { type: String, trim: true, default: '' },
    model: { type: String, trim: true, default: '' },
    serialNumber: { type: String, trim: true, default: '', index: true },

    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null },
    location: { type: String, trim: true, default: '' },

    status: { type: String, enum: ASSET_STATUSES, default: 'in-service', index: true },

    // --- Acquisition and value ---------------------------------------------
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    acquiredOn: { type: Date, default: null },
    acquisitionCost: { type: Number, default: null, min: 0 },
    /** Donated equipment is common in Nepal and has no purchase cost. */
    isDonated: { type: Boolean, default: false },
    donorName: { type: String, trim: true, default: '' },

    warrantyExpiry: { type: Date, default: null, index: true },
    /** Annual/comprehensive maintenance contract. */
    amcProvider: { type: String, trim: true, default: '' },
    amcExpiry: { type: Date, default: null, index: true },

    usefulLifeYears: { type: Number, default: null, min: 0 },
    depreciationRatePercent: { type: Number, default: null, min: 0, max: 100 },

    // --- Maintenance --------------------------------------------------------
    lastServicedAt: { type: Date, default: null },
    nextServiceDue: { type: Date, default: null, index: true },
    serviceIntervalDays: { type: Number, default: null, min: 1 },

    /**
     * Calibration expiry, kept separate from servicing.
     *
     * Lab analysers and radiology equipment legally need current calibration
     * certificates, and a result issued from an out-of-calibration machine is
     * questionable — a different and more urgent problem than a missed service.
     */
    calibrationRequired: { type: Boolean, default: false },
    lastCalibratedAt: { type: Date, default: null },
    calibrationExpiry: { type: Date, default: null, index: true },

    /** Cumulative downtime, which is what answers "why was it unavailable". */
    totalDowntimeHours: { type: Number, default: 0, min: 0 },

    /** The HL7 interface row, where this machine also sends results. */
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },

    condemnedAt: { type: Date, default: null },
    condemnedReason: { type: String, trim: true, default: '' },
    disposedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'assets',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

assetSchema.plugin(auditable);
assetSchema.index({ status: 1, nextServiceDue: 1 });
assetSchema.index({ departmentId: 1, status: 1 });

/** Everything that has lapsed, in one place for the biomedical engineer. */
assetSchema.virtual('overdue').get(function overdue() {
  const now = new Date();
  const items = [];
  if (this.nextServiceDue && new Date(this.nextServiceDue) < now) items.push('service');
  if (this.calibrationRequired && this.calibrationExpiry && new Date(this.calibrationExpiry) < now) {
    items.push('calibration');
  }
  if (this.amcExpiry && new Date(this.amcExpiry) < now) items.push('AMC');
  return items;
});

export const Asset = mongoose.model('Asset', assetSchema);

const maintenanceTaskSchema = new Schema(
  {
    ticketNumber: { type: String, unique: true, index: true },

    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    maintenanceType: { type: String, enum: MAINTENANCE_TYPES, required: true, index: true },

    status: {
      type: String,
      enum: ['open', 'assigned', 'in-progress', 'awaiting-parts', 'completed', 'cancelled'],
      default: 'open',
      index: true,
    },
    priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal', index: true },

    reportedAt: { type: Date, default: Date.now, required: true, index: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    faultDescription: { type: String, trim: true, default: '' },

    /**
     * Whether the machine is unusable. This is what turns a maintenance ticket
     * into a service-availability fact — an out-of-service CT changes what the
     * hospital can accept, not just an engineer's workload.
     */
    assetOutOfService: { type: Boolean, default: false, index: true },
    downtimeStartedAt: { type: Date, default: null },
    downtimeEndedAt: { type: Date, default: null },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** External engineer, where the AMC provider does the work. */
    externalEngineer: { type: String, trim: true, default: '' },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    workDone: { type: String, trim: true, default: '' },
    partsUsed: { type: [String], default: [] },
    cost: { type: Number, default: 0, min: 0 },
    /** Under warranty or AMC, the hospital should not be paying. */
    coveredByWarranty: { type: Boolean, default: false },
    coveredByAmc: { type: Boolean, default: false },

    nextServiceDue: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'maintenanceTasks',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

maintenanceTaskSchema.plugin(auditable);
maintenanceTaskSchema.index({ status: 1, priority: 1, reportedAt: 1 });
maintenanceTaskSchema.index({ assetOutOfService: 1, status: 1 });

maintenanceTaskSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.ticketNumber) {
    this.ticketNumber = await nextFormattedId('maintenanceTask', 'MNT', 6);
  }
  next();
});

/** Hours the asset was unusable — feeds the availability report. */
maintenanceTaskSchema.virtual('downtimeHours').get(function downtime() {
  if (!this.downtimeStartedAt) return null;
  const end = this.downtimeEndedAt ? new Date(this.downtimeEndedAt) : new Date();
  return Math.round(((end - new Date(this.downtimeStartedAt)) / 3600000) * 10) / 10;
});

export const MaintenanceTask = mongoose.model('MaintenanceTask', maintenanceTaskSchema);

export default { SterilisationCycle, InstrumentSet, Asset, MaintenanceTask };
