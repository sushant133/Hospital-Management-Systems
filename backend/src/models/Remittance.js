import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

const remittanceLineSchema = new Schema(
  {
    claimId: { type: Schema.Types.ObjectId, ref: 'Claim', required: true },
    paidAmount: { type: Number, required: true, min: 0 },
    deniedAmount: { type: Number, default: 0, min: 0 },
    denialCode: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

/**
 * An ERA-shaped remittance: what an insurer (or TPA) paid against claims.
 * Not an X12 835 file — the same facts, as JSON the desk can post.
 */
const remittanceSchema = new Schema(
  {
    remittanceNumber: { type: String, unique: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'InsuranceProvider', required: true, index: true },
    receivedAt: { type: Date, default: Date.now },
    reference: { type: String, trim: true, default: '' },
    lines: { type: [remittanceLineSchema], default: [] },
    posted: { type: Boolean, default: false, index: true },
    postedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'remittances',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

remittanceSchema.plugin(auditable);

remittanceSchema.virtual('totalPaid').get(function totalPaid() {
  return (this.lines ?? []).reduce((sum, line) => sum + (line.paidAmount ?? 0), 0);
});

remittanceSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.remittanceNumber) {
    this.remittanceNumber = await nextFormattedId('remittanceNumber', 'ERA', 6);
  }
  next();
});

export const Remittance = mongoose.model('Remittance', remittanceSchema);
export default Remittance;
