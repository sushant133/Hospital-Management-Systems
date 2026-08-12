import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/users.routes.js';
import patientRoutes from '../modules/patients/patients.routes.js';
import departmentRoutes from '../modules/departments/departments.routes.js';
import wardRoutes from '../modules/wards/wards.routes.js';
import encounterRoutes from '../modules/encounters/encounters.routes.js';
import labTestRoutes from '../modules/labTests/labTests.routes.js';
import labOrderRoutes from '../modules/labOrders/labOrders.routes.js';
import labResultRoutes from '../modules/labOrders/labResults.routes.js';
import billingRoutes from '../modules/billing/billing.routes.js';
import auditLogRoutes from '../modules/auditLogs/auditLogs.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Phase 0
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/audit-logs', auditLogRoutes);

// Phase 1
router.use('/patients', patientRoutes);
router.use('/departments', departmentRoutes);
router.use('/wards', wardRoutes);
router.use('/encounters', encounterRoutes);

// Phase 4 — Laboratory
router.use('/lab/tests', labTestRoutes);
router.use('/lab/orders', labOrderRoutes);
router.use('/lab/results', labResultRoutes);

// Shared billing ledger (read-only until Phase 8 adds invoices & payments)
router.use('/billing', billingRoutes);

// Phases 2, 3, 5+ mount here: appointments, admissions, radiology, pharmacy,
// inventory, invoicing, hr, reports.

export default router;
