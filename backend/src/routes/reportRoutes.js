import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import { MODULES } from '../config/permissions.js';
import {
  rangeQuery,
  revenueQuery,
  inventoryReportQuery,
} from '../validators/reportValidator.js';
import * as reports from '../controllers/reportController.js';

const router = Router();

router.use(requireAuth);

const REPORTS = MODULES.REPORTS;

/**
 * Management reporting.
 *
 * Three grants divide this up, and they are not interchangeable:
 *
 *   `reports.viewOperational` — flow, occupancy, department activity
 *   `reports.viewFinancial`   — money: revenue, receivables, stock value
 *   `reports.viewClinical`    — diagnostics turnaround and outcomes
 *   `reports.export`          — taking any of it out as a file
 *
 * Everything here is read-only, so no route carries `audit()` — a row per
 * dashboard refresh would bury the write trail that compliance actually reads.
 */

/**
 * The dashboard. Authenticated but NOT permission-gated on purpose: it returns
 * only the sections the caller holds a grant for, and a role with none of them
 * (a receptionist) gets an empty list rather than a 403 that would break the
 * home page. The gating happens per section, around the query itself.
 */
router.get('/summary', reports.getSummary);

router.get(
  '/revenue',
  requirePermission(REPORTS, 'viewFinancial'),
  validate({ query: revenueQuery }),
  reports.getRevenue,
);

router.get(
  '/occupancy',
  requirePermission(REPORTS, 'viewOperational'),
  validate({ query: rangeQuery }),
  reports.getOccupancy,
);

/** Stock value and expiry exposure are money questions, not store-room ones. */
router.get(
  '/inventory',
  requirePermission(REPORTS, 'viewFinancial'),
  validate({ query: inventoryReportQuery }),
  reports.getInventory,
);

/**
 * Gated on `attendance.view` rather than a reporting grant.
 *
 * The permission follows the DATA, not the page: an aggregate of who worked
 * which hours is still staff data, and a doctor holding `reports.viewOperational`
 * has no business reading the whole rota. `attendance.view` is admin-only, which
 * is the same answer the register itself gives.
 */
router.get(
  '/attendance',
  requirePermission(MODULES.ATTENDANCE, 'view'),
  validate({ query: rangeQuery }),
  reports.getAttendance,
);

router.get(
  '/departments',
  requirePermission(REPORTS, 'viewOperational'),
  validate({ query: rangeQuery }),
  reports.getDepartments,
);

router.get(
  '/clinical',
  requirePermission(REPORTS, 'viewClinical'),
  validate({ query: rangeQuery }),
  reports.getClinical,
);

export default router;
