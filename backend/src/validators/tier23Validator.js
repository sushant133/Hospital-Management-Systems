import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  nonEmptyString,
  password,
  email,
  dateField,
  extendListQuery,
} from '../utils/commonSchemas.js';
import { BLOOD_COMPONENTS, UNIT_STATUSES } from '../models/BloodUnit.js';
import { BLOOD_REQUEST_STATUSES } from '../models/BloodRequest.js';
import { MATERNITY_STATUSES } from '../models/MaternityCase.js';
import { PO_STATUSES } from '../models/PurchaseOrder.js';
import { CONSENT_PURPOSES, CONSENT_STATUSES } from '../models/Consent.js';
import { DEVICE_KINDS } from '../models/Device.js';

export const invitePortalSchema = z.object({
  email: email.optional(),
  password,
});

export const portalLoginSchema = z.object({
  email,
  password: z.string().min(1),
});

export const portalBookSchema = z.object({
  doctorId: objectId,
  departmentId: objectId,
  scheduledStart: dateField,
  scheduledEnd: dateField,
  type: z.enum(['consultation', 'follow-up', 'procedure', 'review']).optional(),
  reason: optionalString(500),
});

export const listCasesQuery = extendListQuery({
  status: z.enum(MATERNITY_STATUSES).optional(),
  patientId: optionalObjectId,
  highRisk: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform((v) => v === true || v === 'true'),
});

export const createCaseSchema = z.object({
  patientId: objectId,
  lmp: dateField,
  edd: dateField.optional(),
  gravida: z.coerce.number().int().min(1).optional(),
  para: z.coerce.number().int().min(0).optional(),
  abortions: z.coerce.number().int().min(0).optional(),
  livingChildren: z.coerce.number().int().min(0).optional(),
  highRisk: z.boolean().optional(),
  riskReasons: z.array(z.string().trim().min(1)).optional(),
  notes: optionalString(2000),
});

export const updateCaseSchema = createCaseSchema.partial().refine((d) => Object.keys(d).length > 0, {
  message: 'Nothing to update',
});

export const ancVisitSchema = z.object({
  weightKg: z.coerce.number().min(0).optional(),
  systolicBp: z.coerce.number().min(0).optional(),
  diastolicBp: z.coerce.number().min(0).optional(),
  fundalHeightCm: z.coerce.number().min(0).optional(),
  fetalHeartBpm: z.coerce.number().min(0).optional(),
  haemoglobin: z.coerce.number().min(0).optional(),
  urineProtein: optionalString(40),
  complaints: optionalString(1000),
  nextVisitOn: dateField.optional().nullable(),
});

export const listImmQuery = extendListQuery({
  patientId: optionalObjectId,
  vaccineCode: optionalString(20),
});

export const createImmSchema = z.object({
  patientId: objectId,
  vaccineCode: nonEmptyString(20, 'Vaccine code'),
  vaccineName: nonEmptyString(120, 'Vaccine name'),
  doseNumber: z.coerce.number().int().min(1).optional(),
  givenAt: dateField.optional(),
  site: optionalString(40),
  route: optionalString(20),
  batchNo: optionalString(40),
  manufacturer: optionalString(80),
  notes: optionalString(500),
});

export const listUnitsQuery = extendListQuery({
  group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  component: z.enum(BLOOD_COMPONENTS).optional(),
  status: z.enum(UNIT_STATUSES).optional(),
});

export const createUnitSchema = z.object({
  group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  component: z.enum(BLOOD_COMPONENTS),
  expiresAt: dateField,
  collectedAt: dateField.optional(),
  volumeMl: z.coerce.number().min(0).optional(),
  donorRef: optionalString(80),
});

export const listBloodReqQuery = extendListQuery({
  status: z.enum(BLOOD_REQUEST_STATUSES).optional(),
  patientId: optionalObjectId,
});

export const createBloodReqSchema = z.object({
  patientId: objectId,
  encounterId: objectId,
  group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  component: z.enum(BLOOD_COMPONENTS),
  unitsRequested: z.coerce.number().int().min(1).default(1),
  indication: nonEmptyString(400, 'Indication'),
  priority: z.enum(['routine', 'urgent', 'stat']).optional(),
});

export const crossmatchSchema = z.object({
  unitIds: z.array(objectId).min(1),
  note: optionalString(500),
});

export const createSupplierSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(24),
  name: nonEmptyString(160, 'Name'),
  contactPerson: optionalString(120),
  phone: optionalString(30),
  email: optionalString(120),
  address: optionalString(400),
  kind: z.enum(['drug', 'general', 'both']).optional(),
  notes: optionalString(1000),
});

export const updateSupplierSchema = createSupplierSchema.partial().refine((d) => Object.keys(d).length > 0);

export const listPoQuery = extendListQuery({
  status: z.enum(PO_STATUSES).optional(),
  supplierId: optionalObjectId,
});

export const createPoSchema = z.object({
  supplierId: objectId,
  expectedOn: dateField.optional().nullable(),
  notes: optionalString(1000),
  lines: z
    .array(
      z.object({
        description: nonEmptyString(200, 'Description'),
        itemCode: optionalString(40),
        inventoryItemId: optionalObjectId,
        drugId: optionalObjectId,
        quantity: z.coerce.number().min(0.01),
        unitCost: z.coerce.number().min(0),
      }),
    )
    .min(1),
});

export const receivePoSchema = z.object({
  lines: z.array(z.object({ lineId: objectId, quantity: z.coerce.number().min(0.01) })).min(1),
});

export const createFacilitySchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(16),
  name: nonEmptyString(160, 'Name'),
  kind: z.enum(['hospital', 'clinic', 'lab', 'pharmacy']).optional(),
  address: optionalString(400),
  phone: optionalString(30),
  isDefault: z.boolean().optional(),
});

export const updateFacilitySchema = createFacilitySchema.partial();

export const grantConsentSchema = z.object({
  patientId: objectId,
  purpose: z.enum(CONSENT_PURPOSES),
  expiresAt: dateField.optional().nullable(),
  scope: optionalString(40),
  encounterId: optionalObjectId,
  notes: optionalString(500),
});

export const listConsentQuery = extendListQuery({
  patientId: optionalObjectId,
  status: z.enum(CONSENT_STATUSES).optional(),
});

export const createRemittanceSchema = z.object({
  providerId: objectId,
  receivedAt: dateField.optional(),
  reference: optionalString(80),
  lines: z
    .array(
      z.object({
        claimId: objectId,
        paidAmount: z.coerce.number().min(0),
        deniedAmount: z.coerce.number().min(0).optional(),
        denialCode: optionalString(20),
        note: optionalString(400),
      }),
    )
    .min(1),
});

export const createDeviceSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(24),
  name: nonEmptyString(160, 'Name'),
  kind: z.enum(DEVICE_KINDS).optional(),
  manufacturer: optionalString(80),
  model: optionalString(80),
  sendingApplication: optionalString(80),
  location: optionalString(80),
  notes: optionalString(500),
});

export const updateDeviceSchema = createDeviceSchema.partial();

export const cdsContextSchema = z.object({
  context: z
    .object({
      patientId: objectId,
      encounterId: optionalObjectId,
    })
    .optional(),
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
});
