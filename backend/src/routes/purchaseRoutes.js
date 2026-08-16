import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam, extendListQuery } from '../utils/commonSchemas.js';
import {
  createSupplierSchema,
  updateSupplierSchema,
  listPoQuery,
  createPoSchema,
  receivePoSchema,
} from '../validators/tier23Validator.js';
import * as controller from '../controllers/purchaseController.js';

const router = Router();
router.use(requireAuth);

router.get('/suppliers', requirePermission(MODULES.SUPPLIERS, 'view'), validate({ query: extendListQuery({}) }), controller.listSuppliers);
router.post(
  '/suppliers',
  requirePermission(MODULES.SUPPLIERS, 'create'),
  validate({ body: createSupplierSchema }),
  audit({ action: 'create', resourceType: 'Supplier' }),
  controller.createSupplier,
);
router.patch(
  '/suppliers/:id',
  requirePermission(MODULES.SUPPLIERS, 'edit'),
  validate({ params: idParam, body: updateSupplierSchema }),
  audit({ action: 'update', resourceType: 'Supplier' }),
  controller.updateSupplier,
);

router.get('/orders', requirePermission(MODULES.PURCHASE, 'view'), validate({ query: listPoQuery }), controller.listOrders);
router.post(
  '/orders',
  requirePermission(MODULES.PURCHASE, 'create'),
  validate({ body: createPoSchema }),
  audit({ action: 'create', resourceType: 'PurchaseOrder' }),
  controller.createOrder,
);
router.get('/orders/:id', requirePermission(MODULES.PURCHASE, 'view'), validate({ params: idParam }), controller.getOrder);
router.post(
  '/orders/:id/submit',
  requirePermission(MODULES.PURCHASE, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'PurchaseOrder' }),
  controller.submitOrder,
);
router.post(
  '/orders/:id/receive',
  requirePermission(MODULES.PURCHASE, 'receive'),
  validate({ params: idParam, body: receivePoSchema }),
  audit({ action: 'update', resourceType: 'PurchaseOrder' }),
  controller.receiveOrder,
);
router.post(
  '/orders/:id/cancel',
  requirePermission(MODULES.PURCHASE, 'cancel'),
  validate({ params: idParam }),
  audit({ action: 'cancel', resourceType: 'PurchaseOrder' }),
  controller.cancelOrder,
);

export default router;
