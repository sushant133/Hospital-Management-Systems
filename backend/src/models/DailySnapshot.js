import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One row per calendar day of operational facts. Written by the warehouse
 * job. Not a star schema — it is the rollup the dashboard can read without
 * scanning every encounter.
 */
const dailySnapshotSchema = new Schema(
  {
    date: { type: Date, required: true, unique: true, index: true },
    encountersOpened: { type: Number, default: 0 },
    encountersClosed: { type: Number, default: 0 },
    admissions: { type: Number, default: 0 },
    discharges: { type: Number, default: 0 },
    invoicesIssued: { type: Number, default: 0 },
    invoiceTotal: { type: Number, default: 0 },
    paymentsTotal: { type: Number, default: 0 },
    claimsSubmitted: { type: Number, default: 0 },
    labOrders: { type: Number, default: 0 },
    surgeries: { type: Number, default: 0 },
    computedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    collection: 'dailySnapshots',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

export const DailySnapshot = mongoose.model('DailySnapshot', dailySnapshotSchema);
export default DailySnapshot;
