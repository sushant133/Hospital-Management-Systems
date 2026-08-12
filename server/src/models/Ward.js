import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

export const WARD_TYPES = [
  'general',
  'private',
  'semi-private',
  'icu',
  'nicu',
  'hdu',
  'isolation',
  'maternity',
  'emergency',
];

const wardSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Ward code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Ward name is required'], trim: true },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'Ward must belong to a department'],
      index: true,
    },

    type: { type: String, enum: WARD_TYPES, default: 'general', index: true },
    gender: { type: String, enum: ['male', 'female', 'mixed'], default: 'mixed' },

    floor: { type: String, trim: true },

    /**
     * Denormalized bed count, recalculated whenever beds are added/removed.
     * Beds themselves live in the `beds` collection because they are
     * individually assignable and queried across wards.
     */
    totalBeds: { type: Number, default: 0, min: 0 },

    inChargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'wards',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

wardSchema.plugin(auditable);
wardSchema.index({ departmentId: 1, isActive: 1 });

export const Ward = mongoose.model('Ward', wardSchema);
export default Ward;
