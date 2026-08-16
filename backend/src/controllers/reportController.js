import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse from '../utils/sendResponse.js';
import { sendCsv } from '../utils/csv.js';
import { getQuery } from '../middleware/validateRequest.js';
import { can, MODULES } from '../config/permissions.js';
import {
  resolveRange,
  revenueReport,
  occupancyReport,
  inventoryReport,
  attendanceReport,
  departmentReport,
  clinicalReport,
  dashboardSummary,
} from '../services/reportingService.js';

/**
 * Management reporting.
 *
 * Every handler here is a READ. Nothing in this controller writes, which is why
 * none of these routes carry the `audit()` middleware the write paths do — an
 * audit row per dashboard refresh would bury the trail that matters.
 */

/**
 * Serve a report as JSON, or as a CSV attachment when asked.
 *
 * The CSV check lives here rather than in the route because `format` is a
 * modifier on an already-authorised request: the caller has proven they may
 * *see* the report, and `reports.export` is the separate question of whether
 * they may take it out of the building. Being able to read a figure on screen
 * is not the same as being able to walk away with the file.
 */
function deliver(req, res, { filename, columns, data, meta, message }) {
  const { format } = getQuery(req);

  if (format === 'csv') {
    if (!can(req.user.role, MODULES.REPORTS, 'export')) {
      throw ApiError.forbidden('Your role is not permitted to export reports.', {
        code: 'INSUFFICIENT_PERMISSION',
        details: { module: MODULES.REPORTS, action: 'export', role: req.user.role },
      });
    }
    return sendCsv(res, { filename, rows: data, columns });
  }

  return sendResponse(res, { message, data, meta });
}

/** Parse the range, turning an inverted one into a 422 rather than empty data. */
function rangeFrom(req) {
  const query = getQuery(req);
  try {
    return { ...resolveRange(query), query };
  } catch (error) {
    throw ApiError.validation(error.message, [{ field: 'from', message: error.message }]);
  }
}

/**
 * GET /reports/summary — the dashboard.
 *
 * Deliberately **not** gated by `requirePermission`. It returns the union of
 * whatever the caller is entitled to see and nothing else, so a receptionist —
 * who holds no `reports.*` grant at all — gets an empty section list rather than
 * a 403 that would break the home page for them. Each section is computed inside
 * its own permission check in the service, so an unentitled caller's data is
 * never read, not merely hidden.
 */
export const getSummary = asyncHandler(async (req, res) => {
  const summary = await dashboardSummary({
    can: (module, action) => can(req.user.role, module, action),
  });

  return sendResponse(res, { data: summary });
});

/** GET /reports/revenue */
export const getRevenue = asyncHandler(async (req, res) => {
  const { start, end, query } = rangeFrom(req);
  const { series, meta } = await revenueReport({ start, end, groupBy: query.groupBy });

  return deliver(req, res, {
    filename: `revenue-${query.groupBy}-${start.toISOString().slice(0, 10)}.csv`,
    data: series,
    meta: { ...meta, range: { from: start, to: end } },
    columns: [
      { key: 'bucket', label: query.groupBy === 'month' ? 'Month' : 'Date' },
      { key: 'billed', label: 'Billed' },
      { key: 'collected', label: 'Collected' },
      { key: 'invoices', label: 'Invoices' },
      { key: 'receipts', label: 'Receipts' },
    ],
  });
});

/** GET /reports/occupancy */
export const getOccupancy = asyncHandler(async (req, res) => {
  const { start, end } = rangeFrom(req);
  const { data, meta } = await occupancyReport({ start, end });

  return deliver(req, res, {
    filename: `occupancy-${start.toISOString().slice(0, 10)}.csv`,
    data,
    meta: { ...meta, range: { from: start, to: end } },
    columns: [
      { key: 'ward', label: 'Ward' },
      { key: 'type', label: 'Type' },
      { key: 'total', label: 'Beds' },
      { key: 'occupied', label: 'Occupied' },
      { key: 'available', label: 'Available' },
      { key: 'unavailable', label: 'Unavailable' },
      { key: 'occupancyRate', label: 'Occupancy %' },
      { key: 'discharges', label: 'Discharges' },
      { key: 'averageStayDays', label: 'Avg stay (days)' },
    ],
  });
});

/** GET /reports/inventory */
export const getInventory = asyncHandler(async (req, res) => {
  const { start, end, query } = rangeFrom(req);
  const { data, meta } = await inventoryReport({ start, end, expiryDays: query.expiryDays });

  return deliver(req, res, {
    filename: `inventory-burn-${start.toISOString().slice(0, 10)}.csv`,
    data,
    meta: { ...meta, range: { from: start, to: end } },
    columns: [
      { key: 'item', label: 'Item' },
      { key: 'issued', label: 'Quantity issued' },
      { key: 'value', label: 'Value' },
      { key: 'movements', label: 'Movements' },
    ],
  });
});

/** GET /reports/attendance — gated on `attendance.view`, see the route. */
export const getAttendance = asyncHandler(async (req, res) => {
  const { start, end } = rangeFrom(req);
  const { data, meta } = await attendanceReport({ start, end });

  return deliver(req, res, {
    filename: `attendance-${start.toISOString().slice(0, 10)}.csv`,
    data,
    meta: { ...meta, range: { from: start, to: end } },
    columns: [
      { key: 'name', label: 'Staff' },
      { key: 'role', label: 'Role' },
      { key: 'department', label: 'Department' },
      { key: 'present', label: 'Present' },
      { key: 'absent', label: 'Absent' },
      { key: 'leave', label: 'Leave' },
      { key: 'half', label: 'Half days' },
      { key: 'payableDays', label: 'Payable days' },
      { key: 'hours', label: 'Hours' },
      { key: 'overtime', label: 'Overtime hours' },
      { key: 'approvedPercent', label: 'Approved %' },
    ],
  });
});

/** GET /reports/departments */
export const getDepartments = asyncHandler(async (req, res) => {
  const { start, end } = rangeFrom(req);
  const { data, meta } = await departmentReport({ start, end });

  return deliver(req, res, {
    filename: `departments-${start.toISOString().slice(0, 10)}.csv`,
    data,
    meta: { ...meta, range: { from: start, to: end } },
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'department', label: 'Department' },
      { key: 'visits', label: 'Visits' },
      { key: 'uniquePatients', label: 'Unique patients' },
      { key: 'admissions', label: 'Admissions' },
      { key: 'booked', label: 'Appointments booked' },
      { key: 'noShow', label: 'No-shows' },
      { key: 'noShowRate', label: 'No-show %' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'beds', label: 'Beds' },
      { key: 'revenuePerBed', label: 'Revenue per bed' },
    ],
  });
});

/** GET /reports/clinical */
export const getClinical = asyncHandler(async (req, res) => {
  const { start, end } = rangeFrom(req);
  const { data, meta } = await clinicalReport({ start, end });

  return deliver(req, res, {
    filename: `diagnostics-turnaround-${start.toISOString().slice(0, 10)}.csv`,
    data,
    meta: { ...meta, range: { from: start, to: end } },
    columns: [
      { key: 'service', label: 'Service' },
      { key: 'priority', label: 'Priority' },
      { key: 'completed', label: 'Completed' },
      { key: 'averageHours', label: 'Average hours' },
      { key: 'slowestHours', label: 'Slowest hours' },
    ],
  });
});
