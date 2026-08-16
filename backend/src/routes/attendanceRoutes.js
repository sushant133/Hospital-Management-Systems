import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import { z } from 'zod';
import {
  listAttendanceQuery,
  ownAttendanceQuery,
  clockSchema,
  upsertAttendanceSchema,
  attendanceSummaryQuery,
} from '../validators/payrollValidator.js';
import {
  listRostersQuery,
  ownRosterQuery,
  createRosterSchema,
  replaceAssignmentsSchema,
  createAssignmentSchema,
} from '../validators/shiftRosterValidator.js';
import { objectId } from '../utils/commonSchemas.js';
import * as attendance from '../controllers/attendanceController.js';
import * as roster from '../controllers/shiftRosterController.js';

const router = Router();

router.use(requireAuth);

const ATTENDANCE = MODULES.ATTENDANCE;

const rosterAssignmentParam = z.object({ id: objectId, assignmentId: objectId });

// --- Shift roster (planned) — literals before /:id ---
router.get(
  '/rosters/me',
  requirePermission(ATTENDANCE, 'recordOwn'),
  validate({ query: ownRosterQuery }),
  roster.listOwnAssignments,
);

router.get(
  '/rosters',
  requirePermission(ATTENDANCE, 'view'),
  validate({ query: listRostersQuery }),
  roster.listRosters,
);

router.post(
  '/rosters',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ body: createRosterSchema }),
  audit({ action: 'create', resourceType: 'ShiftRoster' }),
  roster.createRoster,
);

router.get(
  '/rosters/:id',
  requirePermission(ATTENDANCE, 'view'),
  validate({ params: idParam }),
  roster.getRoster,
);

router.post(
  '/rosters/:id/publish',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'ShiftRoster' }),
  roster.publishRoster,
);

router.post(
  '/rosters/:id/unpublish',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'ShiftRoster' }),
  roster.unpublishRoster,
);

router.put(
  '/rosters/:id/assignments',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ params: idParam, body: replaceAssignmentsSchema }),
  audit({ action: 'update', resourceType: 'ShiftAssignment' }),
  roster.replaceAssignments,
);

router.post(
  '/rosters/:id/assignments',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ params: idParam, body: createAssignmentSchema }),
  audit({ action: 'create', resourceType: 'ShiftAssignment' }),
  roster.upsertAssignment,
);

router.delete(
  '/rosters/:id/assignments/:assignmentId',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ params: rosterAssignmentParam }),
  audit({ action: 'delete', resourceType: 'ShiftAssignment' }),
  roster.removeAssignment,
);

router.delete(
  '/rosters/:id',
  requirePermission(ATTENDANCE, 'manageShifts'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'ShiftRoster' }),
  roster.deleteRoster,
);

/**
 * Attendance — the record that payroll is computed from.
 *
 * Self-service routes come first and are gated on `recordOwn`, which every role
 * holds, so clocking in never depends on being able to see everyone's hours.
 * Recording or amending *someone else's* day is admin-only: marking a colleague
 * absent changes what they are paid.
 */

// --- Self-service ---
router.get(
  '/me',
  requirePermission(ATTENDANCE, 'recordOwn'),
  validate({ query: ownAttendanceQuery }),
  attendance.listOwnAttendance,
);

router.post(
  '/clock-in',
  requirePermission(ATTENDANCE, 'recordOwn'),
  validate({ body: clockSchema }),
  audit({ action: 'create', resourceType: 'Attendance' }),
  attendance.clockIn,
);

router.post(
  '/clock-out',
  requirePermission(ATTENDANCE, 'recordOwn'),
  validate({ body: clockSchema }),
  audit({ action: 'update', resourceType: 'Attendance' }),
  attendance.clockOut,
);

// --- Administration ---
/** Before `/:id` handlers, so "summary" is never read as an id. */
router.get(
  '/summary',
  requirePermission(ATTENDANCE, 'view'),
  validate({ query: attendanceSummaryQuery }),
  attendance.getSummary,
);

router.get(
  '/',
  requirePermission(ATTENDANCE, 'view'),
  validate({ query: listAttendanceQuery }),
  attendance.listAttendance,
);

router.post(
  '/',
  requirePermission(ATTENDANCE, 'create'),
  validate({ body: upsertAttendanceSchema }),
  audit({ action: 'update', resourceType: 'Attendance' }),
  attendance.upsertAttendance,
);

router.post(
  '/:id/approve',
  requirePermission(ATTENDANCE, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'approve', resourceType: 'Attendance' }),
  attendance.approveAttendance,
);

export default router;
