import { Drug, DrugBatch } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Pharmacy logic: which stock to reach for, and whether it is safe to hand it
 * over.
 *
 * Kept out of the controller so the FEFO arithmetic and the allergy matching
 * are testable on their own — both are rules a pharmacist would want to see
 * demonstrated rather than take on trust.
 */

// ----------------------------------------------------------------- FEFO ----

/**
 * Batches of a drug that may be dispensed, **first-expiring first**.
 *
 * FEFO, not FIFO: the pack that expires soonest goes first regardless of when
 * it arrived, because the alternative is watching short-dated stock expire on
 * the shelf while newer stock is handed out. This is the query the
 * `{ drugId, expiryDate }` index exists for.
 */
export async function dispensableBatches(drugId, { now = new Date() } = {}) {
  return DrugBatch.find({
    drugId,
    isActive: true,
    status: 'active',
    quantityOnHand: { $gt: 0 },
    // Expired stock is never offered, even if nothing has marked it yet.
    expiryDate: { $gt: now },
  })
    .sort({ expiryDate: 1, createdAt: 1 })
    .lean();
}

/** Total dispensable stock for a drug, across every usable batch. */
export async function stockOnHand(drugId, { now = new Date() } = {}) {
  const batches = await dispensableBatches(drugId, { now });
  return batches.reduce((sum, batch) => sum + batch.quantityOnHand, 0);
}

/**
 * Work out which batches satisfy `quantity`, taking the earliest expiry first
 * and splitting across batches when one is not enough.
 *
 * Returns the allocation without touching stock — the caller commits it, so a
 * failure part-way through cannot leave quantities half-decremented.
 *
 * @returns {Promise<{ allocations: Array, shortfall: number, available: number }>}
 */
export async function allocateFefo({ drugId, quantity, now = new Date() }) {
  const batches = await dispensableBatches(drugId, { now });

  const allocations = [];
  let remaining = quantity;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantityOnHand, remaining);
    allocations.push({
      batchId: batch._id,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      quantity: take,
    });
    remaining -= take;
  }

  const available = batches.reduce((sum, batch) => sum + batch.quantityOnHand, 0);
  return { allocations, shortfall: Math.max(0, remaining), available };
}

/**
 * Commit an allocation: decrement each batch, marking any that empties as
 * depleted.
 *
 * Uses a guarded conditional update per batch (`quantityOnHand >= take`), so
 * two pharmacists dispensing the last pack at the same moment cannot both
 * succeed — the second gets a clean conflict rather than negative stock.
 */
export async function commitAllocation({ allocations, user }) {
  const committed = [];

  for (const allocation of allocations) {
    const updated = await DrugBatch.findOneAndUpdate(
      { _id: allocation.batchId, quantityOnHand: { $gte: allocation.quantity } },
      {
        $inc: { quantityOnHand: -allocation.quantity },
        $set: { updatedBy: user?._id ?? null },
      },
      { new: true },
    );

    if (!updated) {
      // Roll back what this call already took, so a partial failure leaves the
      // shelf as it was found.
      await rollbackAllocation({ allocations: committed, user });
      throw ApiError.conflict(
        `Batch ${allocation.batchNo} no longer has ${allocation.quantity} unit(s) available. Someone else may have dispensed it — try again.`,
        { code: 'BATCH_STOCK_CHANGED', details: { batchId: String(allocation.batchId) } },
      );
    }

    if (updated.quantityOnHand === 0 && updated.status === 'active') {
      updated.status = 'depleted';
      await updated.save();
    }

    committed.push(allocation);
  }

  return committed;
}

/** Return stock to its batches — used by rollback and by dispense returns. */
export async function rollbackAllocation({ allocations, user }) {
  for (const allocation of allocations) {
    await DrugBatch.findByIdAndUpdate(allocation.batchId, {
      $inc: { quantityOnHand: allocation.quantity },
      $set: {
        updatedBy: user?._id ?? null,
        // Stock coming back makes a depleted batch usable again.
        ...(allocation.restoreActive === false ? {} : { status: 'active' }),
      },
    });
  }
}

// -------------------------------------------------------------- allergies ----

/**
 * Normalise for comparison: lowercase, trimmed, punctuation-insensitive.
 * "Penicillin V" and "penicillin-v" must match the class "penicillin".
 */
function normalise(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Does a recorded allergy cover this drug?
 *
 * Matches on three things, in order of confidence:
 *   1. an allergen class declared on the drug ('penicillin'),
 *   2. the generic name,
 *   3. the brand name.
 *
 * Substring matching is deliberate and deliberately generous: "amoxicillin"
 * contains no substring of "penicillin", which is exactly why the drug master
 * carries `allergenClasses` — the name alone is not enough, and a false warning
 * a pharmacist dismisses costs far less than a missed one.
 */
export function matchAllergies({ drug, allergies = [] }) {
  const haystacks = [
    ...(drug.allergenClasses ?? []).map((c) => ({ text: normalise(c), matchedClass: c })),
    { text: normalise(drug.genericName), matchedClass: drug.genericName },
    { text: normalise(drug.name), matchedClass: drug.name },
  ].filter((entry) => entry.text);

  const matches = [];

  for (const allergy of allergies) {
    const substance = normalise(allergy.substance);
    if (!substance) continue;

    const hit = haystacks.find(
      (entry) => entry.text.includes(substance) || substance.includes(entry.text),
    );

    if (hit) {
      matches.push({
        drugId: drug._id,
        drugName: drug.name,
        substance: allergy.substance,
        severity: allergy.severity ?? 'moderate',
        matchedClass: hit.matchedClass,
      });
    }
  }

  return matches;
}

/** Run the allergy check across every drug in a dispense. */
export function checkAllergies({ drugs, allergies = [] }) {
  return drugs.flatMap((drug) => matchAllergies({ drug, allergies }));
}

// ------------------------------------------------------------- monitoring ----

/** Batches expiring within `days`, soonest first. */
export async function expiringBatches({ days = 90, now = new Date() } = {}) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + days);

  return DrugBatch.find({
    isActive: true,
    status: 'active',
    quantityOnHand: { $gt: 0 },
    expiryDate: { $lte: cutoff },
  })
    .populate({ path: 'drugId', select: 'drugCode name strength unit' })
    .sort({ expiryDate: 1 })
    .lean();
}

/**
 * Drugs whose total usable stock has fallen to or below their reorder level.
 *
 * Counts only dispensable stock — stock that is expired or quarantined cannot
 * serve a patient, so including it would hide a genuine shortage.
 */
export async function lowStockDrugs({ now = new Date() } = {}) {
  const drugs = await Drug.find({ isActive: true, reorderLevel: { $gt: 0 } })
    .select('drugCode name strength unit reorderLevel')
    .lean();

  const rows = [];
  for (const drug of drugs) {
    const onHand = await stockOnHand(drug._id, { now });
    if (onHand <= drug.reorderLevel) {
      rows.push({ ...drug, quantityOnHand: onHand, shortBy: drug.reorderLevel - onHand });
    }
  }

  return rows.sort((a, b) => b.shortBy - a.shortBy);
}

export default {
  allocateFefo,
  commitAllocation,
  rollbackAllocation,
  dispensableBatches,
  stockOnHand,
  matchAllergies,
  checkAllergies,
  expiringBatches,
  lowStockDrugs,
};
