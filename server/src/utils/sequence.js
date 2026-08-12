import Counter from '../models/Counter.js';

/**
 * Atomically increment a named counter and return the next value.
 * Uses a single findOneAndUpdate with upsert, so concurrent callers cannot
 * receive the same number.
 */
export async function nextSequence(name) {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return counter.value;
}

/**
 * Formatted business identifier, e.g. formatId('MRN', 42, 6) -> 'MRN-000042'
 */
export function formatId(prefix, value, width = 6) {
  return `${prefix}-${String(value).padStart(width, '0')}`;
}

/** Convenience: allocate the next formatted id for a sequence in one call. */
export async function nextFormattedId(sequenceName, prefix, width = 6) {
  const value = await nextSequence(sequenceName);
  return formatId(prefix, value, width);
}

export default nextSequence;
