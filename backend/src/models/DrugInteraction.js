import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const INTERACTION_SEVERITIES = ['mild', 'moderate', 'severe'];

/**
 * Pairwise interaction between two generic names (case-insensitive match).
 * Stored both ways is not required — the checker normalises the pair.
 */
const drugInteractionSchema = new Schema(
  {
    genericA: { type: String, required: true, trim: true, lowercase: true, index: true },
    genericB: { type: String, required: true, trim: true, lowercase: true, index: true },
    severity: { type: String, enum: INTERACTION_SEVERITIES, required: true },
    description: { type: String, required: true, trim: true },
  },
  {
    timestamps: true,
    collection: 'drugInteractions',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

drugInteractionSchema.plugin(auditable);
drugInteractionSchema.index({ genericA: 1, genericB: 1 }, { unique: true });

export const DrugInteraction = mongoose.model('DrugInteraction', drugInteractionSchema);
export default DrugInteraction;
