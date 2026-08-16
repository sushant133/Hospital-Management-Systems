import Counter from '../models/Counter.js';
import { fiscalYearOf } from './nepal.js';

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

/**
 * ============================================================================
 * FISCAL-YEAR SCOPED SEQUENCE — for tax documents
 * ============================================================================
 *
 * Invoices and credit notes must be numbered sequentially *within the Nepali
 * fiscal year*, restarting at 1 on Shrawan 1 and never skipping or reusing a
 * number. IRD reads a gap in the sequence as a suppressed sale, so the counter
 * is keyed by fiscal year and the year is stored on the document alongside it.
 *
 * Returns `{ number, fiscalYear, sequence }`, e.g.
 *   { number: 'INV-2081/82-000123', fiscalYear: '2081-82', sequence: 123 }
 *
 * The human-readable fiscal year goes *inside* the number because that is how
 * a Nepali bill book reads, and because it makes the document self-describing
 * when it turns up on its own in an audit.
 *
 * NOTE ON GAPS: allocating a number and then failing to save the document
 * leaves a hole. That is why callers must allocate as late as possible (in the
 * model's pre-save hook, as `Invoice` and `CreditNote` do) and why the issue
 * step, not the draft step, is what consumes a number.
 */
export async function nextFiscalSequence(documentType, prefix, { asOf = new Date(), width = 6 } = {}) {
  const fy = fiscalYearOf(asOf);
  if (!fy) throw new Error(`Cannot determine the Nepali fiscal year for ${asOf}.`);

  const counterName = `${documentType}:${fy.code}`;
  const sequence = await nextSequence(counterName);

  return {
    number: `${prefix}-${fy.labelEn}-${String(sequence).padStart(width, '0')}`,
    fiscalYear: fy.code,
    sequence,
  };
}

/**
 * Read a fiscal sequence counter without consuming a number.
 * Used by the IRD reconciliation report to assert the sequence has no holes.
 */
export async function peekFiscalSequence(documentType, fiscalYearCode) {
  const counter = await Counter.findById(`${documentType}:${fiscalYearCode}`).lean();
  return counter?.value ?? 0;
}

export default nextSequence;
