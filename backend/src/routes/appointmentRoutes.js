import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam } from '../utils/commonSchemas.js';
import {
  listAppointmentsQuery,
  slotsQuery,
  scheduleQuery,
  queueQuery,
  createAppointmentSchema,
  createWalkInSchema,
  updateAppointmentSchema,
  rescheduleSchema,
  cancelAppointmentSchema,
  noShowSchema,
  checkInSchema,
  availabilityQuery,
  createAvailabilitySchema,
  updateAvailabilitySchema,
} from '../validators/appointmentValidator.js';
import * as controller from '../controllers/appointmentController.js';

const router = Router();

router.use(requireAuth);

const APPOINTMENTS = MODULES.APPOINTMENTS;

/**
 * Ordering matters: every literal path below is declared before '/:id', or
 * Express would match '/slots' as an id and the validator would reject it.
 */

// --- Doctor availability (the source of every generated slot) ---
router.get(
  '/availability',
  requirePermission(APPOINTMENTS, 'view'),
  validate({ query: availabilityQuery }),
  controller.listAvailability,
);

router.post(
  '/availability',
  requirePermission(APPOINTMENTS, 'manageAvailability'),
  validate({ body: createAvailabilitySchema }),
  audit({ action: 'create', resourceType: 'DoctorAvailability' }),
  controller.createAvailability,
);

router.patch(
  '/availability/:id',
  requirePermission(APPOINTMENTS, 'manageAvailability'),
  validate({ params: idParam, body: updateAvailabilitySchema }),
  audit({ action: 'update', resourceType: 'DoctorAvailability' }),
  controller.updateAvailability,
);

router.delete(
  '/availability/:id',
  requirePermission(APPOINTMENTS, 'manageAvailability'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'DoctorAvailability' }),
  controller.deleteAvailability,
);

// --- Read views ---
router.get(
  '/slots',
  requirePermission(APPOINTMENTS, 'view'),
  validate({ query: slotsQuery }),
  controller.listSlots,
);

router.get(
  '/schedule',
  requirePermission(APPOINTMENTS, 'view'),
  validate({ query: scheduleQuery }),
  controller.getDaySchedule,
);

router.get(
  '/queue',
  requirePermission(APPOINTMENTS, 'view'),
  validate({ query: queueQuery }),
  controller.getWalkInQueue,
);

// --- Booking ---
router.post(
  '/walk-in',
  requirePermission(APPOINTMENTS, 'create'),
  validate({ body: createWalkInSchema }),
  audit({ action: 'create', resourceType: 'Appointment' }),
  controller.createWalkIn,
);

router.get(
  '/',
  requirePermission(APPOINTMENTS, 'view'),
  validate({ query: listAppointmentsQuery }),
  controller.listAppointments,
);

router.post(
  '/',
  requirePermission(APPOINTMENTS, 'create'),
  validate({ body: createAppointmentSchema }),
  audit({ action: 'create', resourceType: 'Appointment' }),
  controller.createAppointment,
);

router.get(
  '/:id',
  requirePermission(APPOINTMENTS, 'view'),
  validate({ params: idParam }),
  controller.getAppointment,
);

router.patch(
  '/:id',
  requirePermission(APPOINTMENTS, 'edit'),
  validate({ params: idParam, body: updateAppointmentSchema }),
  audit({ action: 'update', resourceType: 'Appointment' }),
  controller.updateAppointment,
);

// --- Lifecycle ---
// Rescheduling closes this booking and opens a replacement, so it is gated on
// `edit` and audited against the original the patient gave up.
router.post(
  '/:id/reschedule',
  requirePermission(APPOINTMENTS, 'edit'),
  validate({ params: idParam, body: rescheduleSchema }),
  audit({ action: 'update', resourceType: 'Appointment' }),
  controller.rescheduleAppointment,
);

router.post(
  '/:id/cancel',
  requirePermission(APPOINTMENTS, 'cancel'),
  validate({ params: idParam, body: cancelAppointmentSchema }),
  audit({ action: 'cancel', resourceType: 'Appointment' }),
  controller.cancelAppointment,
);

router.post(
  '/:id/no-show',
  requirePermission(APPOINTMENTS, 'markNoShow'),
  validate({ params: idParam, body: noShowSchema }),
  audit({ action: 'update', resourceType: 'Appointment' }),
  controller.markNoShow,
);

// Opens the encounter the clinical record hangs off — a clinical write, not
// just a scheduling one.
router.post(
  '/:id/check-in',
  requirePermission(APPOINTMENTS, 'checkIn'),
  validate({ params: idParam, body: checkInSchema }),
  audit({ action: 'update', resourceType: 'Appointment' }),
  controller.checkIn,
);

router.post(
  '/:id/complete',
  requirePermission(APPOINTMENTS, 'edit'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Appointment' }),
  controller.completeAppointment,
);

router.delete(
  '/:id',
  requirePermission(APPOINTMENTS, 'delete'),
  validate({ params: idParam }),
  audit({ action: 'delete', resourceType: 'Appointment' }),
  controller.deleteAppointment,
);

export default router;
