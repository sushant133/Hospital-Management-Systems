import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const INVENTORY_CATEGORIES = [
  'consumable',
  'ppe',
  'surgical',
  'linen',
  'stationery',
  'equipment',
  'furniture',
  'maintenance',
  'other',
];

/**
 * Non-drug stock: consumables and assets.
 *
 * Separate from `drugs` because the rules differ. A syringe has no expiry to
 * dispense against, no allergy to check and no prescription behind it — it is
 * received, issued to a department and consumed. Medicines keep their own
 * batch-level model precisely because those rules do not apply here.
 *
 * `quantityOnHand` is a running balance maintained by
 * `services/inventoryService.js`; `inventoryTransactions` is the ledger it is
 * derived from, and the two are reconcilable.
 */
const inventoryItemSchema = new Schema(
  {
    itemCode: {
      type: String,
      required: [true, 'Item code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Item name is required'], trim: true },
    description: { type: String, trim: true, default: '' },

    category: { type: String, enum: INVENTORY_CATEGORIES, default: 'consumable', index: true },
    /** How it is counted: box, piece, pair, roll. */
    unit: { type: String, required: [true, 'Unit is required'], trim: true },

    quantityOnHand: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, min: 0, default: 0 },

    unitCost: { type: Number, min: 0, default: 0 },

    /** Where it physically lives — 'Central store', 'Theatre store'. */
    location: { type: String, trim: true, default: '' },

    /**
     * Assets are durable and expected back: a wheelchair issued to a ward is
     * still hospital property, whereas a box of gloves is consumed. Both live
     * here, but only assets are normally returned.
     */
    isAsset: { type: Boolean, default: false, index: true },

    supplier: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'inventoryItems',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

inventoryItemSchema.plugin(auditable);

inventoryItemSchema.index({ name: 1 });
inventoryItemSchema.index({ category: 1, isActive: 1 });

/** True when stock has fallen to or below the level it should be reordered at. */
inventoryItemSchema.virtual('needsReorder').get(function needsReorder() {
  return this.reorderLevel > 0 && this.quantityOnHand <= this.reorderLevel;
});

/** What the stock on hand is worth, for the store's valuation. */
inventoryItemSchema.virtual('stockValue').get(function stockValue() {
  return Math.round((this.quantityOnHand ?? 0) * (this.unitCost ?? 0) * 100) / 100;
});

export const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema);
export default InventoryItem;
