import { lowStockDrugs } from '../services/pharmacyService.js';
import { lowStockItems } from '../services/inventoryService.js';

/**
 * Report everything that has fallen to or below its reorder level — drugs from
 * the pharmacy, and non-drug consumables from the general store.
 *
 * Both are here because a store manager wants one list of what to order, not
 * two. For drugs, "usable" is the important word: expired and quarantined stock
 * is excluded, so a shelf full of out-of-date boxes still reads as a shortage
 * rather than hiding one.
 *
 * Read-only — it changes nothing, it just surfaces what needs ordering.
 *
 * Scheduled by `jobs/scheduler.js` at JOBS_HOUR, or one-shot via `npm run jobs`.
 */
export async function runLowStockAlertJob({ now = new Date(), logger = console } = {}) {
  const [drugRows, itemRows] = await Promise.all([lowStockDrugs({ now }), lowStockItems()]);

  const outOfStock = [...drugRows, ...itemRows].filter((row) => row.quantityOnHand === 0);

  const summary = {
    lowStockCount: drugRows.length + itemRows.length,
    outOfStockCount: outOfStock.length,
    drugs: drugRows.map((row) => ({
      drugCode: row.drugCode,
      name: row.name,
      quantityOnHand: row.quantityOnHand,
      reorderLevel: row.reorderLevel,
      shortBy: row.shortBy,
    })),
    inventory: itemRows.map((row) => ({
      itemCode: row.itemCode,
      name: row.name,
      unit: row.unit,
      quantityOnHand: row.quantityOnHand,
      reorderLevel: row.reorderLevel,
      shortBy: row.shortBy,
    })),
  };

  if (summary.lowStockCount === 0) {
    logger.log('[lowStockAlertJob] nothing below its reorder level');
  } else {
    logger.log(
      `[lowStockAlertJob] ${drugRows.length} drug(s) and ${itemRows.length} store item(s) ` +
        `at or below reorder level, ${outOfStock.length} completely out of stock`,
    );
  }

  return summary;
}

export default runLowStockAlertJob;
