import mongoose from 'mongoose';

/**
 * Mongoose plugin applied to every business collection.
 *
 * Adds the conventions from ARCHITECTURE.md §5:
 *   - soft delete: isActive / deletedAt / deletedBy
 *   - audit trail: createdBy / updatedBy (+ createdAt / updatedAt via timestamps)
 *
 * Also adds instance helpers so controllers never hand-roll the delete patch.
 */
export function auditable(schema) {
  schema.add({
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  });

  schema.methods.softDelete = function softDelete(user) {
    this.isActive = false;
    this.deletedAt = new Date();
    this.deletedBy = user?._id ?? null;
    this.updatedBy = user?._id ?? null;
    return this.save();
  };

  schema.methods.restore = function restore(user) {
    this.isActive = true;
    this.deletedAt = null;
    this.deletedBy = null;
    this.updatedBy = user?._id ?? null;
    return this.save();
  };

  /** Only records that have not been soft-deleted. */
  schema.query.active = function active() {
    return this.where({ isActive: true });
  };
}

export default auditable;
