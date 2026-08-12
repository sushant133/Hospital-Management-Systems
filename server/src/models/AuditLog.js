import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Actions worth recording. `view` exists for the day read-access logging is
 * turned on for PHI; today only writes are wired up (see middleware/audit.js).
 */
export const AUDIT_ACTIONS = Object.freeze([
  'create',
  'update',
  'delete',
  'restore',
  'view',
  'export',
  'login',
  'login_failed',
  'logout',
  'password_change',
  'password_reset',
  // Workflow steps that are not plain CRUD but must still be attributable.
  'verify',
  'amend',
  'cancel',
  'approve',
  'dispense',
  'override',
]);

export const AUDIT_OUTCOMES = Object.freeze(['success', 'failure']);

/**
 * Append-only compliance trail.
 *
 * Deliberately does NOT use the `auditable` plugin: audit entries have no
 * soft-delete, no updatedBy and no edit path. They are written once and never
 * modified — a mutable audit log is not an audit log. The schema is locked with
 * `strict: 'throw'` and pre-hooks that reject updates and deletes outright.
 */
const auditLogSchema = new Schema(
  {
    // --- Who ---
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /** Snapshotted so the trail stays readable if the account is later renamed. */
    userName: { type: String, trim: true },
    userRole: { type: String, trim: true, index: true },

    // --- What ---
    action: { type: String, required: true, enum: AUDIT_ACTIONS, index: true },
    /** Permission module the route was gated on, e.g. 'patients'. */
    module: { type: String, required: true, trim: true, index: true },
    /** Mongoose model name, e.g. 'Patient'. */
    resourceType: { type: String, required: true, trim: true },
    resourceId: { type: Schema.Types.ObjectId },
    /** Human-readable identifier for the record: 'MRN-000012', 'LAB-000004'. */
    resourceRef: { type: String, trim: true },

    /**
     * Set on anything belonging to a patient, so "show me everyone who touched
     * this patient's record" is a single indexed query rather than a scan.
     */
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter' },

    /** Field-level before/after, redacted and limited to what actually changed. */
    changes: { type: Schema.Types.Mixed, default: null },
    /** Free-text justification for overrides (duplicate override, amendments). */
    reason: { type: String, trim: true },

    // --- Where from ---
    method: { type: String, trim: true },
    path: { type: String, trim: true },
    statusCode: { type: Number },
    outcome: { type: String, enum: AUDIT_OUTCOMES, default: 'success', index: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'auditLogs',
    strict: 'throw',
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// The three queries the audit viewer actually runs.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ patientId: 1, createdAt: -1 });

/** Immutability, enforced at the model layer rather than by convention. */
function rejectMutation(next) {
  next(new Error('Audit log entries are append-only and cannot be modified or removed.'));
}

auditLogSchema.pre('updateOne', rejectMutation);
auditLogSchema.pre('updateMany', rejectMutation);
auditLogSchema.pre('findOneAndUpdate', rejectMutation);
auditLogSchema.pre('deleteOne', rejectMutation);
auditLogSchema.pre('deleteMany', rejectMutation);
auditLogSchema.pre('findOneAndDelete', rejectMutation);

auditLogSchema.pre('save', function blockResave(next) {
  if (!this.isNew) {
    return next(new Error('Audit log entries are append-only and cannot be modified.'));
  }
  return next();
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
