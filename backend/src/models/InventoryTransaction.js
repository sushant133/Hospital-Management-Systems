import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const TRANSACTION_TYPES = ['receipt', 'issue', 'adjustment', 'return'];

/** Which way each type moves stock. Adjustments carry their own sign. */
export const TRANSACTION_DIRECTION = Object.freeze({
  receipt: 1,
  issue: -1,
  return: 1,
  adjustment: 0,
});

/**
 * The stock ledger — every movement, append-only in practice.
 *
 * `inventoryItems.quantityOnHand` is a running balance for speed; this is what
 * it is derived from. Each row records the balance *after* it was applied, so a
 * discrepancy can be traced to the movement that caused it rather than
 * re-summing the whole history.
 */
const inventoryTransactionSchema = new Schema(
  {
    itemId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: [true, 'A transaction must reference an item'],
      index: true,
    },
    /** Snapshotted so the ledger stays readable if the item is later renamed. */
    itemName: { type: String, trim: true, default: '' },

    type: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },

    /**
     * Always positive. `type` decides the direction, except for an adjustment,
     * where `signedQuantity` carries it — a stock count can go either way.
     */
    quantity: { type: Number, required: true, min: 1 },
    /** The movement as applied: negative for an issue or a downward correction. */
    signedQuantity: { type: Number, required: true },

    /** Balance after this movement, for reconciliation. */
    balanceAfter: { type: Number, required: true, min: 0 },

    /** Who received it (issue) or sent it back (return). */
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },

    /** Delivery note, requisition number, purchase order. */
    reference: { type: String, trim: true, default: '' },
    /** Required for adjustments — stock that changes without a stated reason cannot be reconciled. */
    reason: { type: String, trim: true, default: '' },

    unitCost: { type: Number, min: 0, default: 0 },
    /** Value of the movement, for consumption and valuation reporting. */
    lineValue: { type: Number, default: 0 },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A transaction must record who performed it'],
    },
    occurredAt: { type: Date, default: () => new Date(), index: true },
  },
  {
    timestamps: true,
    collection: 'inventoryTransactions',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

inventoryTransactionSchema.plugin(auditable);

// An item's movement history, and per-department consumption reporting.
inventoryTransactionSchema.index({ itemId: 1, occurredAt: -1 });
inventoryTransactionSchema.index({ departmentId: 1, type: 1, occurredAt: -1 });
inventoryTransactionSchema.index({ type: 1, occurredAt: -1 });

/** Issues and returns are movements between the store and a department. */
inventoryTransactionSchema.pre('validate', function requireDepartment(next) {
  if (['issue', 'return'].includes(this.type) && !this.departmentId) {
    return next(new Error(`An ${this.type} must name the department`));
  }
  if (this.type === 'adjustment' && !(this.reason ?? '').trim()) {
    return next(new Error('An adjustment must state a reason'));
  }
  return next();
});

export const InventoryTransaction = mongoose.model(
  'InventoryTransaction',
  inventoryTransactionSchema,
);
export default InventoryTransaction;
