import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listItemsQuery,
  createItemSchema,
  updateItemSchema,
  recordTransactionSchema,
  listTransactionsQuery,
  consumptionQuery,
} from '../validators/inventoryValidator.js';
import * as controller from '../controllers/inventoryController.js';

const router = Router();

router.use(requireAuth);

const INVENTORY = MODULES.INVENTORY;

/** Literal paths before '/items/:id', or they would be read as ids. */

router.get(
  '/alerts',
  requirePermission(INVENTORY, 'view'),
  controller.getAlerts,
);

router.get(
  '/consumption',
  requirePermission(INVENTORY, 'view'),
  validate({ query: consumptionQuery }),
  controller.getConsumption,
);

// --- The ledger ---
router.get(
  '/transactions',
  requirePermission(INVENTORY, 'view'),
  validate({ query: listTransactionsQuery }),
  controller.listTransactions,
);

/**
 * Receipts, issues, adjustments and returns all land here. Gated on `transact`
 * rather than `edit`: ward staff move stock every day, but only an admin
 * changes what the catalogue says an item *is*.
 */
router.post(
  '/transactions',
  requirePermission(INVENTORY, 'transact'),
  validate({ body: recordTransactionSchema }),
  audit({ action: 'update', resourceType: 'InventoryTransaction' }),
  controller.recordTransaction,
);

// --- The catalogue ---
router.get(
  '/items',
  requirePermission(INVENTORY, 'view'),
  validate({ query: listItemsQuery }),
  controller.listItems,
);

router.post(
  '/items',
  requirePermission(INVENTORY, 'create'),
  validate({ body: createItemSchema }),
  audit({ action: 'create', resourceType: 'InventoryItem' }),
  controller.createItem,
);

router.get(
  '/items/:id',
  requirePermission(INVENTORY, 'view'),
  validate({ params: idParam }),
  controller.getItem,
);

router.patch(
  '/items/:id',
  requirePermission(INVENTORY, 'edit'),
  validate({ params: idParam, body: updateItemSchema }),
  audit({ action: 'update', resourceType: 'InventoryItem' }),
  controller.updateItem,
);

router.delete(
  '/items/:id',
  requirePermission(INVENTORY, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'InventoryItem' }),
  controller.deleteItem,
);

export default router;
