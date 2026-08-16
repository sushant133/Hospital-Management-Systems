import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import validate from '../middleware/validateRequest.js';
import audit from '../middleware/auditLogger.js';
import { MODULES } from '../config/permissions.js';
import { idParam, extendListQuery } from '../utils/commonSchemas.js';
import {
  createFacilitySchema,
  updateFacilitySchema,
  grantConsentSchema,
  listConsentQuery,
  createRemittanceSchema,
  createDeviceSchema,
  updateDeviceSchema,
  cdsContextSchema,
} from '../validators/tier23Validator.js';
import * as facilities from '../controllers/facilityController.js';
import * as fhir from '../controllers/fhirController.js';
import * as cds from '../controllers/cdsController.js';
import * as hie from '../controllers/hieController.js';
import * as remittance from '../controllers/remittanceController.js';
import * as devices from '../controllers/deviceController.js';
import * as warehouse from '../controllers/warehouseController.js';

export const facilityRouter = Router();
facilityRouter.use(requireAuth);
facilityRouter.get('/', requirePermission(MODULES.FACILITIES, 'view'), validate({ query: extendListQuery({}) }), facilities.listFacilities);
facilityRouter.post(
  '/',
  requirePermission(MODULES.FACILITIES, 'manage'),
  validate({ body: createFacilitySchema }),
  audit({ action: 'create', resourceType: 'Facility' }),
  facilities.createFacility,
);
facilityRouter.patch(
  '/:id',
  requirePermission(MODULES.FACILITIES, 'manage'),
  validate({ params: idParam, body: updateFacilitySchema }),
  audit({ action: 'update', resourceType: 'Facility' }),
  facilities.updateFacility,
);

export const fhirRouter = Router();
fhirRouter.use(requireAuth);
fhirRouter.get('/metadata', requirePermission(MODULES.FHIR, 'read'), fhir.metadata);
fhirRouter.get('/Patient', requirePermission(MODULES.FHIR, 'read'), fhir.searchPatient);
fhirRouter.get('/Patient/:id', requirePermission(MODULES.FHIR, 'read'), fhir.readPatient);
fhirRouter.get('/Encounter', requirePermission(MODULES.FHIR, 'read'), fhir.searchEncounter);
fhirRouter.get('/Observation', requirePermission(MODULES.FHIR, 'read'), fhir.searchObservation);
fhirRouter.get('/MedicationRequest', requirePermission(MODULES.FHIR, 'read'), fhir.searchMedicationRequest);
fhirRouter.get('/Encounter/:id/$everything', requirePermission(MODULES.FHIR, 'read'), fhir.encounterBundle);

export const cdsRouter = Router();
cdsRouter.use(requireAuth);
cdsRouter.get('/', requirePermission(MODULES.CDS, 'view'), cds.listServices);
cdsRouter.post(
  '/patient-view',
  requirePermission(MODULES.CDS, 'view'),
  validate({ body: cdsContextSchema }),
  cds.runPatientView,
);

export const hieRouter = Router();
hieRouter.use(requireAuth);
hieRouter.get('/consents', requirePermission(MODULES.HIE, 'view'), validate({ query: listConsentQuery }), hie.listConsents);
hieRouter.post(
  '/consents',
  requirePermission(MODULES.HIE, 'consent'),
  validate({ body: grantConsentSchema }),
  audit({ action: 'create', resourceType: 'Consent' }),
  hie.grantConsent,
);
hieRouter.post(
  '/consents/:id/revoke',
  requirePermission(MODULES.HIE, 'consent'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Consent' }),
  hie.revokeConsent,
);
hieRouter.post(
  '/encounters/:encounterId/bundle',
  requirePermission(MODULES.HIE, 'export'),
  hie.exportBundle,
);

export const remittanceRouter = Router();
remittanceRouter.use(requireAuth);
remittanceRouter.get('/', requirePermission(MODULES.CLAIMS, 'view'), validate({ query: extendListQuery({}) }), remittance.listRemittances);
remittanceRouter.post(
  '/',
  requirePermission(MODULES.CLAIMS, 'recordDecision'),
  validate({ body: createRemittanceSchema }),
  audit({ action: 'create', resourceType: 'Remittance' }),
  remittance.createRemittance,
);
remittanceRouter.post(
  '/:id/post',
  requirePermission(MODULES.CLAIMS, 'recordDecision'),
  validate({ params: idParam }),
  audit({ action: 'update', resourceType: 'Remittance' }),
  remittance.postRemittance,
);
remittanceRouter.get(
  '/claims/:id/export',
  requirePermission(MODULES.CLAIMS, 'view'),
  validate({ params: idParam }),
  remittance.exportClaim,
);

export const deviceRouter = Router();
deviceRouter.use(requireAuth);
deviceRouter.get('/', requirePermission(MODULES.DEVICES, 'view'), validate({ query: extendListQuery({}) }), devices.listDevices);
deviceRouter.post(
  '/',
  requirePermission(MODULES.DEVICES, 'manage'),
  validate({ body: createDeviceSchema }),
  audit({ action: 'create', resourceType: 'Device' }),
  devices.createDevice,
);
deviceRouter.patch(
  '/:id',
  requirePermission(MODULES.DEVICES, 'manage'),
  validate({ params: idParam, body: updateDeviceSchema }),
  audit({ action: 'update', resourceType: 'Device' }),
  devices.updateDevice,
);

export const warehouseRouter = Router();
warehouseRouter.use(requireAuth);
warehouseRouter.get('/', requirePermission(MODULES.WAREHOUSE, 'view'), warehouse.listSnapshots);
warehouseRouter.post('/', requirePermission(MODULES.WAREHOUSE, 'view'), warehouse.rebuildToday);
