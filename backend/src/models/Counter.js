import mongoose from 'mongoose';

/**
 * Atomic sequence generator backing human-readable business identifiers
 * (MRN-000001, ENC-000001, EMP-00001, ...).
 *
 * _id is the sequence name, e.g. 'patientMrn'. Incremented via
 * findOneAndUpdate($inc) so concurrent requests can never collide.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = mongoose.model('Counter', counterSchema, 'counters');
export default Counter;
