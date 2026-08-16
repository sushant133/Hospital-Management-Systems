import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * DIETARY (C6), HOUSEKEEPING, LINEN AND WASTE (C9)
 * ============================================================================
 *
 * The services that make a ward function, and that every HMS treats as beneath
 * notice until a bed cannot be filled or a waste inspection arrives.
 */

/* ==========================================================================
 * C6 — DIET ORDERS AND KITCHEN
 * ======================================================================= */

export const DIET_TYPES = Object.freeze([
  'normal',
  'soft',
  'liquid',
  'diabetic',
  'renal',
  'cardiac',
  'low-salt',
  'high-protein',
  'nil-by-mouth',
  'tube-feed',
  'paediatric',
  'post-operative',
]);

export const MEAL_TIMES = Object.freeze(['breakfast', 'lunch', 'snack', 'dinner']);

/**
 * A diet order is a CLINICAL instruction, not a catering preference.
 *
 * Nil-by-mouth before theatre is the case that matters: a patient fed at 6am
 * for an 8am list has their operation cancelled, and currently nothing connects
 * the theatre schedule to the food trolley. `nilByMouthFrom` exists so the
 * kitchen count can honour it automatically rather than relying on a nurse
 * remembering to phone.
 */
const dietOrderSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', required: true, index: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null, index: true },
    bedId: { type: Schema.Types.ObjectId, ref: 'Bed', default: null },

    dietType: { type: String, enum: DIET_TYPES, required: true, index: true },
    /** Therapeutic detail: calorie target, fluid restriction, consistency. */
    specification: { type: String, trim: true, default: '' },
    caloriesPerDay: { type: Number, default: null, min: 0 },
    fluidRestrictionMl: { type: Number, default: null, min: 0 },

    /**
     * Food allergies, copied from the chart at order time.
     *
     * Denormalised deliberately: the kitchen must not need a database join to
     * avoid killing someone, and the printed tray card has to carry it.
     */
    allergies: { type: [String], default: [] },
    culturalRestriction: { type: String, trim: true, default: '' },

    /** Meals this patient is entitled to — not everyone gets all four. */
    meals: { type: [String], enum: MEAL_TIMES, default: ['breakfast', 'lunch', 'dinner'] },

    /** Set from the theatre schedule; the kitchen count honours it. */
    nilByMouthFrom: { type: Date, default: null },
    nilByMouthReason: { type: String, trim: true, default: '' },

    orderedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderedAt: { type: Date, default: Date.now },
    discontinuedAt: { type: Date, default: null, index: true },
    discontinuedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'dietOrders',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

dietOrderSchema.plugin(auditable);
/** The kitchen's query: active orders by ward. */
dietOrderSchema.index({ wardId: 1, discontinuedAt: 1, dietType: 1 });
dietOrderSchema.index({ patientId: 1, discontinuedAt: 1 });

/** Whether this patient should be fed at a given moment. */
dietOrderSchema.methods.isFeedableAt = function feedable(at = new Date()) {
  if (this.discontinuedAt) return false;
  if (this.dietType === 'nil-by-mouth') return false;
  if (this.nilByMouthFrom && new Date(this.nilByMouthFrom) <= at) return false;
  return true;
};

export const DietOrder = mongoose.model('DietOrder', dietOrderSchema);

/* ==========================================================================
 * C9 — HOUSEKEEPING
 * ======================================================================= */

export const TASK_TYPES = Object.freeze([
  'discharge-clean',
  'routine-clean',
  'terminal-clean', // after an isolation patient — deeper, takes longer
  'spillage',
  'linen-change',
  'waste-collection',
]);

export const TASK_STATUSES = Object.freeze(['pending', 'assigned', 'in-progress', 'completed', 'verified', 'cancelled']);

/**
 * A cleaning or portering task.
 *
 * ---------------------------------------------------------------------------
 * BED TURNAROUND IS THE REAL WARD CONSTRAINT
 * ---------------------------------------------------------------------------
 * The bed board already has a `cleaning` status with nothing behind it — a bed
 * enters it and leaves when somebody remembers. That gap is where admissions
 * queue. Raising a task on discharge and releasing the bed on completion is
 * what turns the status into a process, and `turnaroundMinutes` is the number
 * that shows whether it is working.
 *
 * A terminal clean after an isolation patient takes materially longer, which is
 * why it is its own type rather than a flag — the ward needs to know the bed
 * will not be back in twenty minutes.
 */
const housekeepingTaskSchema = new Schema(
  {
    taskType: { type: String, enum: TASK_TYPES, required: true, index: true },
    status: { type: String, enum: TASK_STATUSES, default: 'pending', index: true },
    priority: { type: String, enum: ['urgent', 'normal', 'low'], default: 'normal', index: true },

    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null, index: true },
    bedId: { type: Schema.Types.ObjectId, ref: 'Bed', default: null, index: true },
    location: { type: String, trim: true, default: '' },

    /** Set when the task was raised automatically by a discharge. */
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    /** Isolation precautions in force — changes the method and the kit. */
    isolationType: { type: String, trim: true, default: '' },

    raisedAt: { type: Date, default: Date.now, required: true, index: true },
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /** A nurse confirms the bed is fit to use. Cleaning is not self-certified. */
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'housekeepingTasks',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

housekeepingTaskSchema.plugin(auditable);
housekeepingTaskSchema.index({ status: 1, priority: 1, raisedAt: 1 });
housekeepingTaskSchema.index({ bedId: 1, status: 1 });

/** Minutes from raised to verified — the bed turnaround measure. */
housekeepingTaskSchema.virtual('turnaroundMinutes').get(function turnaround() {
  const end = this.verifiedAt || this.completedAt;
  if (!end) return null;
  return Math.round((new Date(end) - new Date(this.raisedAt)) / 60000);
});

export const HousekeepingTask = mongoose.model('HousekeepingTask', housekeepingTaskSchema);

/* ==========================================================================
 * C9 — HEALTHCARE WASTE
 * ======================================================================= */

/**
 * Waste categories, by the colour-coded segregation Nepal's healthcare waste
 * rules require. Segregation at source is the whole regulation: infectious
 * waste in a general bag contaminates the entire load.
 */
export const WASTE_CATEGORIES = Object.freeze({
  GENERAL: 'general', // green/blue
  INFECTIOUS: 'infectious', // red
  SHARPS: 'sharps', // puncture-proof
  PATHOLOGICAL: 'pathological',
  PHARMACEUTICAL: 'pharmaceutical',
  CHEMICAL: 'chemical',
  RADIOACTIVE: 'radioactive',
});

export const WASTE_CATEGORY_VALUES = Object.freeze(Object.values(WASTE_CATEGORIES));

export const DISPOSAL_METHODS = Object.freeze([
  'autoclave',
  'incineration',
  'deep-burial',
  'chemical-disinfection',
  'municipal-collection',
  'authorised-contractor',
  'returned-to-supplier',
]);

const wasteLogSchema = new Schema(
  {
    category: { type: String, enum: WASTE_CATEGORY_VALUES, required: true, index: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', default: null, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    sourceLocation: { type: String, trim: true, default: '' },

    weightKg: { type: Number, required: true, min: 0 },
    containerCount: { type: Number, default: null, min: 0 },

    collectedAt: { type: Date, default: Date.now, required: true, index: true },
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    disposalMethod: { type: String, enum: [...DISPOSAL_METHODS, ''], default: '' },
    disposedAt: { type: Date, default: null },
    disposedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** The contractor and their manifest — what an inspector asks to see. */
    contractorName: { type: String, trim: true, default: '' },
    manifestNumber: { type: String, trim: true, default: '' },

    /** Segregation failures are the finding worth tracking, not the weight. */
    segregationBreach: { type: Boolean, default: false, index: true },
    breachNote: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'wasteLogs',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

wasteLogSchema.plugin(auditable);
wasteLogSchema.index({ category: 1, collectedAt: -1 });
wasteLogSchema.index({ disposedAt: 1, category: 1 });

export const WasteLog = mongoose.model('WasteLog', wasteLogSchema);

/* ==========================================================================
 * C9 — LINEN
 * ======================================================================= */

const linenTransactionSchema = new Schema(
  {
    direction: { type: String, enum: ['issue', 'return', 'condemn'], required: true, index: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true, index: true },

    items: {
      type: [
        new Schema(
          {
            itemType: { type: String, required: true, trim: true },
            quantity: { type: Number, required: true, min: 0 },
            /** Soiled and infected linen is bagged and washed separately. */
            condition: {
              type: String,
              enum: ['clean', 'soiled', 'infected', 'damaged'],
              default: 'clean',
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    occurredAt: { type: Date, default: Date.now, required: true, index: true },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'linenTransactions',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

linenTransactionSchema.plugin(auditable);
linenTransactionSchema.index({ wardId: 1, occurredAt: -1 });

export const LinenTransaction = mongoose.model('LinenTransaction', linenTransactionSchema);

export default { DietOrder, HousekeepingTask, WasteLog, LinenTransaction };
