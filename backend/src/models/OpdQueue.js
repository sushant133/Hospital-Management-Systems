import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { toNepaliDigits } from '../utils/nepal.js';

const { Schema } = mongoose;

export const TOKEN_STATUSES = Object.freeze([
  'waiting',
  'called',
  'in-consultation',
  'completed',
  'no-show',
  'deferred', // called, absent, sent to the back rather than discarded
  'cancelled',
]);

export const QUEUE_PRIORITIES = Object.freeze(['emergency', 'priority', 'normal']);

/**
 * ============================================================================
 * OPD QUEUE AND TOKEN DISPLAY (C2)
 * ============================================================================
 *
 * In a Nepali OPD running 400 patients a day, this is the single most visible
 * thing a patient experiences. Today they take a paper slip and watch a door.
 *
 * ---------------------------------------------------------------------------
 * PRIORITY IS NOT A QUEUE JUMP, IT IS A SEPARATE LANE
 * ---------------------------------------------------------------------------
 * Elderly patients (the senior-citizen entitlement in A7 identifies them),
 * pregnant women and people with disabilities are entitled to be seen ahead of
 * the general queue. Implementing that by editing someone's token number would
 * be invisible and would look like corruption to everyone waiting. Instead each
 * priority band draws from its own sequence, and the calling rule interleaves
 * them at a fixed ratio — so the board shows P-004 called between N-012 and
 * N-013 and the reason is legible.
 *
 * ---------------------------------------------------------------------------
 * A DEFERRED PATIENT IS NOT A NO-SHOW
 * ---------------------------------------------------------------------------
 * Someone who misses their call because they were in the toilet or paying a
 * bill should go to the back of the queue, not lose their place in the day.
 * `deferred` preserves them; `no-show` is the terminal state after the second
 * miss.
 */
const opdTokenSchema = new Schema(
  {
    /** Human-readable token: "N-012", "P-004", "E-002". */
    tokenNumber: { type: String, required: true, index: true },
    /** The numeric part, for ordering within a band. */
    sequence: { type: Number, required: true },
    priority: { type: String, enum: QUEUE_PRIORITIES, default: 'normal', index: true },
    /** Why this patient is in a priority lane — shown to whoever asks. */
    priorityReason: { type: String, trim: true, default: '' },

    /** The queue is scoped to one day, one department, one doctor. */
    queueDate: { type: Date, required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    counterName: { type: String, trim: true, default: '' },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },

    status: { type: String, enum: TOKEN_STATUSES, default: 'waiting', index: true },

    issuedAt: { type: Date, default: Date.now, required: true },
    calledAt: { type: Date, default: null },
    /** Times called — the second miss makes it a no-show. */
    callCount: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    calledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'opdTokens',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

opdTokenSchema.plugin(auditable);

/** The display board query: today, this department, still waiting. */
opdTokenSchema.index({ queueDate: 1, departmentId: 1, status: 1, priority: 1, sequence: 1 });
opdTokenSchema.index({ queueDate: 1, doctorId: 1, status: 1 });
/** One token per patient per department per day. */
opdTokenSchema.index(
  { queueDate: 1, departmentId: 1, patientId: 1 },
  { unique: true, partialFilterExpression: { status: { $nin: ['cancelled', 'no-show'] } } },
);

/** The token as it appears on the board, in the reader's script. */
opdTokenSchema.methods.displayToken = function displayToken(locale = 'ne') {
  return locale === 'ne' ? toNepaliDigits(this.tokenNumber) : this.tokenNumber;
};

/** Minutes the patient has been waiting — the measure that feeds B11. */
opdTokenSchema.virtual('waitMinutes').get(function wait() {
  const end = this.startedAt ? new Date(this.startedAt) : new Date();
  return Math.floor((end - new Date(this.issuedAt)) / 60000);
});

export const OpdToken = mongoose.model('OpdToken', opdTokenSchema);

/**
 * Per-counter calling state.
 *
 * Held as its own small document rather than derived, because the display board
 * polls it constantly and "what is showing right now" must be one cheap read
 * rather than an aggregation across the day's tokens.
 */
const queueCounterSchema = new Schema(
  {
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    counterName: { type: String, required: true, trim: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    queueDate: { type: Date, required: true, index: true },

    nowServing: { type: String, trim: true, default: '' },
    nowServingTokenId: { type: Schema.Types.ObjectId, ref: 'OpdToken', default: null },
    lastCalledAt: { type: Date, default: null },

    /**
     * How many normal tokens are called between each priority token.
     * A ratio rather than absolute precedence: unlimited precedence would let a
     * steady trickle of priority patients starve the general queue completely.
     */
    priorityRatio: { type: Number, default: 3, min: 1 },
    /** Normal tokens called since the last priority one. */
    sinceLastPriority: { type: Number, default: 0, min: 0 },

    isOpen: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    collection: 'queueCounters',
    toJSON: { transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

queueCounterSchema.plugin(auditable);
queueCounterSchema.index({ queueDate: 1, departmentId: 1, counterName: 1 }, { unique: true });

export const QueueCounter = mongoose.model('QueueCounter', queueCounterSchema);

export default { OpdToken, QueueCounter };
