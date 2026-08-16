import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission, requirePermissionOrOwn } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listStructuresQuery,
  createStructureSchema,
  listRunsQuery,
  createRunSchema,
  rebuildRunSchema,
  approveRunSchema,
  markPaidSchema,
  cancelRunSchema,
  listPayslipsQuery,
} from '../validators/payrollValidator.js';
import * as payroll from '../controllers/payrollController.js';

const router = Router();

router.use(requireAuth);

const PAYROLL = MODULES.PAYROLL;

/**
 * Payroll — salary structures, monthly runs and payslips.
 *
 * Access is separated from patient billing: an accountant
 * who invoices patients is not thereby entitled to see what colleagues earn,
 * and vice versa. Everything here is `payroll.*`, never `billing.*`.
 */

// --- Salary structures ---
router.get(
  '/structures',
  requirePermission(PAYROLL, 'view'),
  validate({ query: listStructuresQuery }),
  payroll.listStructures,
);

router.post(
  '/structures',
  requirePermission(PAYROLL, 'edit'),
  validate({ body: createStructureSchema }),
  audit({ action: 'create', resourceType: 'SalaryStructure' }),
  payroll.createStructure,
);

// --- Runs ---
router.get(
  '/runs',
  requirePermission(PAYROLL, 'view'),
  validate({ query: listRunsQuery }),
  payroll.listRuns,
);

router.post(
  '/runs',
  requirePermission(PAYROLL, 'create'),
  validate({ body: createRunSchema }),
  audit({ action: 'create', resourceType: 'PayrollRun' }),
  payroll.createRun,
);

router.get(
  '/runs/:id',
  requirePermission(PAYROLL, 'view'),
  validate({ params: idParam }),
  payroll.getRun,
);

router.post(
  '/runs/:id/rebuild',
  requirePermission(PAYROLL, 'edit'),
  validate({ params: idParam, body: rebuildRunSchema }),
  audit({ action: 'update', resourceType: 'PayrollRun' }),
  payroll.rebuildRun,
);

/**
 * Signing off a run is `payroll.approve`, which no role holds explicitly — so
 * admin only. The accountant who built the run cannot authorise paying it, and
 * the controller refuses self-approval on top of that.
 */
router.post(
  '/runs/:id/approve',
  requirePermission(PAYROLL, 'approve'),
  validate({ params: idParam, body: approveRunSchema }),
  audit({ action: 'approve', resourceType: 'PayrollRun' }),
  payroll.approveRun,
);

router.post(
  '/runs/:id/pay',
  requirePermission(PAYROLL, 'approve'),
  validate({ params: idParam, body: markPaidSchema }),
  audit({ action: 'update', resourceType: 'PayrollRun' }),
  payroll.markPaid,
);

router.post(
  '/runs/:id/cancel',
  requirePermission(PAYROLL, 'approve'),
  validate({ params: idParam, body: cancelRunSchema }),
  audit({ action: 'cancel', resourceType: 'PayrollRun' }),
  payroll.cancelRun,
);

// --- Payslips ---
/** Before `/payslips/:id`, so "me" is never parsed as an object id. */
router.get('/payslips/me', requirePermission(PAYROLL, 'viewOwn'), payroll.listOwnPayslips);

router.get(
  '/payslips',
  requirePermission(PAYROLL, 'view'),
  validate({ query: listPayslipsQuery }),
  payroll.listPayslips,
);

/**
 * An accountant may read anyone's payslip; anyone may read their own. This is
 * what `requirePermissionOrOwn` was written for — its docstring uses exactly
 * this example, and until now nothing had wired it up.
 *
 * Ownership cannot be judged from the URL alone (the id is the payslip's, not
 * the staff member's), so the record is loaded first and the guard reads the
 * owner off it. Loading before authorising is safe here: the loader returns
 * nothing to the caller, and the guard still decides who gets the response.
 */
router.get(
  '/payslips/:id',
  validate({ params: idParam }),
  payroll.loadPayslip,
  requirePermissionOrOwn(
    PAYROLL,
    'view',
    'viewOwn',
    (req) => String(req.payslipOwnerId ?? '') === String(req.user._id),
  ),
  payroll.getPayslip,
);

export default router;
