import {
  Drug,
  Prescription,
  Dispense,
  Patient,
  Encounter,
} from '../models/index.js';
import { can, MODULES } from '../config/permissions.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { createCharges } from '../services/billingService.js';
import {
  allocateFefo,
  commitAllocation,
  rollbackAllocation,
  checkAllergies,
} from '../services/pharmacyService.js';

const PRESCRIPTION_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender' },
  { path: 'encounterId', select: 'encounterNumber type status' },
  { path: 'prescribedBy', select: 'firstName lastName role specialization' },
];

const DISPENSE_POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName' },
  { path: 'prescriptionId', select: 'prescriptionNumber status' },
  { path: 'dispensedBy', select: 'firstName lastName role' },
];

// --------------------------------------------------------- prescribing ----

/** GET /pharmacy/prescriptions */
export const listPrescriptions = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-createdAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.prescribedBy ? { prescribedBy: query.prescribedBy } : null,
    query.status ? { status: query.status } : null,
    // The pharmacy queue: anything still owing.
    query.pendingOnly ? { status: { $in: ['pending', 'partially-dispensed'] } } : null,
  );

  const [prescriptions, total] = await Promise.all([
    Prescription.find(filter).populate(PRESCRIPTION_POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    Prescription.countDocuments(filter),
  ]);

  return sendResponse(res, { data: prescriptions, meta: buildMeta({ page, limit, total }) });
});

/** GET /pharmacy/prescriptions/:id */
export const getPrescription = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.id)
    .populate(PRESCRIPTION_POPULATE)
    .lean();
  if (!prescription) throw ApiError.notFound('Prescription not found');

  const dispenses = await Dispense.find({ prescriptionId: prescription._id, isActive: true })
    .populate(DISPENSE_POPULATE)
    .sort({ dispensedAt: -1 })
    .lean();

  return sendResponse(res, { data: { ...prescription, dispenses } });
});

/**
 * POST /pharmacy/prescriptions — prescribe from an encounter.
 *
 * Allergy warnings are surfaced here as well as at dispense: telling the
 * prescriber at the point of writing is worth more than telling the pharmacist
 * an hour later, even though the dispense-time check is the one that gates.
 */
export const createPrescription = asyncHandler(async (req, res) => {
  const { patientId, encounterId, items, ...rest } = req.body;

  const patient = await Patient.findOne({ _id: patientId, isActive: true })
    .select('mrn firstName lastName medicalHistory')
    .lean();
  if (!patient) {
    throw ApiError.badRequest('The selected patient does not exist or is inactive', {
      details: [{ field: 'patientId', message: 'Invalid patient' }],
    });
  }

  const encounter = await Encounter.findOne({ _id: encounterId, isActive: true }).lean();
  if (!encounter) {
    throw ApiError.badRequest('The selected visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }
  if (String(encounter.patientId) !== String(patientId)) {
    throw ApiError.badRequest('That visit belongs to a different patient', {
      details: [{ field: 'encounterId', message: 'Visit and patient do not match' }],
    });
  }
  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict('Cannot prescribe against a closed visit', {
      code: 'ENCOUNTER_CLOSED',
    });
  }

  const drugIds = items.map((item) => item.drugId);
  const drugs = await Drug.find({ _id: { $in: drugIds }, isActive: true }).lean();

  if (drugs.length !== new Set(drugIds.map(String)).size) {
    throw ApiError.badRequest('One or more drugs are not in the formulary', {
      details: [{ field: 'items', message: 'Unknown or retired drug' }],
    });
  }
  const drugById = new Map(drugs.map((drug) => [String(drug._id), drug]));

  const prescription = await Prescription.create({
    ...rest,
    patientId,
    encounterId,
    prescribedBy: req.user._id,
    items: items.map((item) => {
      const drug = drugById.get(String(item.drugId));
      return {
        ...item,
        drugName: drug.name,
        strength: drug.strength,
        form: drug.form,
        route: item.route ?? drug.defaultRoute,
        quantityDispensed: 0,
      };
    }),
    status: 'pending',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  // Advisory only — this does not block prescribing.
  const warnings = checkAllergies({
    drugs,
    allergies: patient.medicalHistory?.allergies ?? [],
  });

  const { checkInteractions, checkDoseRanges } = await import('../services/safetyService.js');
  const [interactions, doseWarnings] = await Promise.all([
    checkInteractions({ drugs }),
    Promise.resolve(checkDoseRanges({ drugs, items })),
  ]);

  await prescription.populate(PRESCRIPTION_POPULATE);
  return sendCreated(res, {
    message: warnings.length
      ? `Prescription created — ${warnings.length} allergy warning(s) for this patient`
      : 'Prescription created',
    data: prescription,
    meta: { allergyWarnings: warnings, interactions, doseWarnings },
  });
});

/** POST /pharmacy/prescriptions/:id/cancel */
export const cancelPrescription = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.id);
  if (!prescription) throw ApiError.notFound('Prescription not found');

  if (prescription.status === 'cancelled') {
    throw ApiError.conflict('This prescription is already cancelled', { code: 'ALREADY_CANCELLED' });
  }
  if (prescription.status === 'dispensed') {
    throw ApiError.conflict(
      'This prescription has been fully dispensed and cannot be cancelled. Record a return instead.',
      { code: 'ALREADY_DISPENSED' },
    );
  }

  prescription.status = 'cancelled';
  prescription.cancelledAt = new Date();
  prescription.cancelledBy = req.user._id;
  prescription.cancellationReason = req.body.reason ?? '';
  prescription.updatedBy = req.user._id;
  await prescription.save();

  await prescription.populate(PRESCRIPTION_POPULATE);
  return sendResponse(res, { message: 'Prescription cancelled', data: prescription });
});

// ---------------------------------------------------------- dispensing ----

/**
 * GET /pharmacy/prescriptions/:id/dispense-preview
 *
 * What *would* happen: which batches FEFO would draw from, and which allergy
 * warnings stand. Lets the pharmacist see the decision before committing to it,
 * and lets the UI show the override prompt before anything moves.
 */
export const previewDispense = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.id).lean();
  if (!prescription) throw ApiError.notFound('Prescription not found');

  const patient = await Patient.findById(prescription.patientId)
    .select('medicalHistory')
    .lean();

  const drugIds = prescription.items.map((item) => item.drugId);
  const drugs = await Drug.find({ _id: { $in: drugIds } }).lean();
  const drugById = new Map(drugs.map((drug) => [String(drug._id), drug]));

  const lines = [];
  for (const item of prescription.items) {
    const remaining = item.quantity - item.quantityDispensed;
    if (remaining <= 0) continue;

    const { allocations, shortfall, available } = await allocateFefo({
      drugId: item.drugId,
      quantity: remaining,
    });

    const unitPrice = drugById.get(String(item.drugId))?.sellingPrice ?? 0;

    lines.push({
      prescriptionItemId: item._id,
      drugId: item.drugId,
      drugName: item.drugName,
      requested: remaining,
      available,
      shortfall,
      allocations,
      unitPrice,
      // What the patient will be charged if this is dispensed in full.
      estimatedTotal: Math.round((remaining - shortfall) * unitPrice * 100) / 100,
    });
  }

  const warnings = checkAllergies({
    drugs,
    allergies: patient?.medicalHistory?.allergies ?? [],
  });

  return sendResponse(res, {
    data: { lines, allergyWarnings: warnings },
    meta: {
      canDispenseInFull: lines.every((line) => line.shortfall === 0),
      requiresOverride: warnings.length > 0,
    },
  });
});

/**
 * POST /pharmacy/prescriptions/:id/dispense
 *
 * The heart of the phase. In order:
 *   1. refuse a cancelled or already-complete prescription,
 *   2. run the allergy check and refuse unless explicitly overridden,
 *   3. allocate stock FEFO and commit it with guarded decrements,
 *   4. record the dispense, advance the prescription, raise the charge.
 *
 * Stock is committed before the dispense document is written, and rolled back
 * if anything after it fails — the shelf must never disagree with the record.
 */
export const dispensePrescription = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.id);
  if (!prescription) throw ApiError.notFound('Prescription not found');

  if (prescription.status === 'cancelled') {
    throw ApiError.conflict('This prescription has been cancelled', { code: 'PRESCRIPTION_CANCELLED' });
  }
  if (prescription.status === 'dispensed') {
    throw ApiError.conflict('This prescription has already been dispensed in full', {
      code: 'ALREADY_DISPENSED',
    });
  }

  const patient = await Patient.findById(prescription.patientId)
    .select('mrn firstName lastName medicalHistory')
    .lean();

  const drugIds = prescription.items.map((item) => item.drugId);
  const drugs = await Drug.find({ _id: { $in: drugIds } }).lean();
  const drugById = new Map(drugs.map((drug) => [String(drug._id), drug]));

  // --- 1. Which lines are being supplied on this visit to the counter? ---
  const requested = req.body.items?.length
    ? req.body.items
    : prescription.items
        .filter((item) => item.quantityDispensed < item.quantity)
        .map((item) => ({
          prescriptionItemId: String(item._id),
          quantity: item.quantity - item.quantityDispensed,
        }));

  if (!requested.length) {
    throw ApiError.badRequest('Nothing left to dispense on this prescription');
  }

  // --- 2. The allergy gate ---
  const suppliedDrugIds = new Set();
  for (const line of requested) {
    const item = prescription.items.id(line.prescriptionItemId);
    if (!item) {
      throw ApiError.badRequest('One of the items is not on this prescription', {
        details: [{ field: 'items', message: `Unknown item ${line.prescriptionItemId}` }],
      });
    }
    suppliedDrugIds.add(String(item.drugId));
  }

  const warnings = checkAllergies({
    drugs: drugs.filter((drug) => suppliedDrugIds.has(String(drug._id))),
    allergies: patient?.medicalHistory?.allergies ?? [],
  });

  const override = req.body.overrideAllergyWarning === true;

  if (warnings.length > 0 && !override) {
    throw ApiError.conflict(
      `This patient has a recorded allergy matching ${warnings
        .map((w) => w.drugName)
        .join(', ')}. Dispensing requires an explicit override with a reason.`,
      { code: 'ALLERGY_WARNING', details: { warnings } },
    );
  }

  if (override) {
    // The override is a separate permission from dispensing, re-checked here so
    // it cannot be reached by putting a flag in the request body.
    if (!can(req.user.role, MODULES.DISPENSING, 'overrideAllergyWarning')) {
      throw ApiError.forbidden('Your role may not override an allergy warning.', {
        code: 'INSUFFICIENT_PERMISSION',
        details: { module: MODULES.DISPENSING, action: 'overrideAllergyWarning' },
      });
    }
    if (warnings.length === 0) {
      throw ApiError.badRequest('There is no allergy warning to override');
    }
    if (!req.body.overrideReason || req.body.overrideReason.trim().length < 10) {
      throw ApiError.validation('An override reason is required', [
        { field: 'overrideReason', message: 'Give a reason of at least 10 characters' },
      ]);
    }
  }

  // --- 3. FEFO allocation ---
  const dispenseItems = [];
  const committed = [];

  try {
    for (const line of requested) {
      const item = prescription.items.id(line.prescriptionItemId);
      const remaining = item.quantity - item.quantityDispensed;
      const wanted = Math.min(line.quantity ?? remaining, remaining);

      if (wanted <= 0) continue;

      const { allocations, shortfall, available } = await allocateFefo({
        drugId: item.drugId,
        quantity: wanted,
      });

      if (shortfall > 0) {
        throw ApiError.conflict(
          `Insufficient stock for ${item.drugName}: ${available} available, ${wanted} needed.`,
          {
            code: 'INSUFFICIENT_STOCK',
            details: { drugName: item.drugName, available, requested: wanted },
          },
        );
      }

      const drug = drugById.get(String(item.drugId));
      const unitPrice = drug?.sellingPrice ?? 0;

      const taken = await commitAllocation({ allocations, user: req.user });
      committed.push(...taken);

      for (const allocation of allocations) {
        dispenseItems.push({
          drugId: item.drugId,
          drugName: item.drugName,
          prescriptionItemId: item._id,
          batchId: allocation.batchId,
          batchNo: allocation.batchNo,
          expiryDate: allocation.expiryDate,
          quantity: allocation.quantity,
          unitPrice,
          lineTotal: Math.round(allocation.quantity * unitPrice * 100) / 100,
        });
      }

      item.quantityDispensed += wanted;
    }

    if (!dispenseItems.length) {
      throw ApiError.badRequest('Nothing left to dispense on this prescription');
    }

    // --- 4. Record it ---
    const dispense = await Dispense.create({
      patientId: prescription.patientId,
      encounterId: prescription.encounterId,
      prescriptionId: prescription._id,
      items: dispenseItems,
      allergyWarnings: warnings.map((warning) => ({
        ...warning,
        overridden: override,
        overriddenBy: override ? req.user._id : null,
        overrideReason: override ? req.body.overrideReason.trim() : '',
      })),
      dispensedBy: req.user._id,
      dispensedAt: new Date(),
      notes: req.body.notes ?? '',
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    prescription.refreshStatus();
    prescription.updatedBy = req.user._id;
    await prescription.save();

    // Charges go through the shared ledger like every other module.
    await createCharges({
      patientId: prescription.patientId,
      encounterId: prescription.encounterId,
      sourceType: 'pharmacy',
      sourceId: dispense._id,
      sourceRef: dispense.dispenseNumber,
      items: dispenseItems.map((item) => ({
        itemCode: item.batchNo,
        description: `${item.drugName} × ${item.quantity}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      user: req.user,
    });

    await dispense.populate(DISPENSE_POPULATE);

    // The override is the thing a reviewer will look for, so it leads the message.
    const message = override
      ? `Dispensed ${dispense.dispenseNumber} — ALLERGY WARNING OVERRIDDEN`
      : `Dispensed ${dispense.dispenseNumber}`;

    return sendCreated(res, {
      message,
      data: dispense,
      meta: { prescriptionStatus: prescription.status, allergyWarnings: warnings },
    });
  } catch (error) {
    // Put the stock back before surfacing the failure.
    if (committed.length) await rollbackAllocation({ allocations: committed, user: req.user });
    throw error;
  }
});

/** GET /pharmacy/dispenses */
export const listDispenses = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip } = buildPagination({ ...query, sort: '-dispensedAt' });

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.prescriptionId ? { prescriptionId: query.prescriptionId } : null,
    query.batchId ? { 'items.batchId': query.batchId } : null,
    query.overriddenOnly ? { 'allergyWarnings.overridden': true } : null,
  );

  const [dispenses, total] = await Promise.all([
    Dispense.find(filter).populate(DISPENSE_POPULATE).sort({ dispensedAt: -1 }).skip(skip).limit(limit).lean(),
    Dispense.countDocuments(filter),
  ]);

  return sendResponse(res, { data: dispenses, meta: buildMeta({ page, limit, total }) });
});

/**
 * POST /pharmacy/dispenses/:id/return — stock handed back.
 *
 * Returns the units to their original batches and reverses the prescription's
 * dispensed counts, so the prescription becomes outstanding again.
 */
export const returnDispense = asyncHandler(async (req, res) => {
  const dispense = await Dispense.findById(req.params.id);
  if (!dispense) throw ApiError.notFound('Dispense not found');

  if (dispense.returnedAt) {
    throw ApiError.conflict('This dispense has already been returned', { code: 'ALREADY_RETURNED' });
  }

  await rollbackAllocation({
    allocations: dispense.items.map((item) => ({
      batchId: item.batchId,
      quantity: item.quantity,
    })),
    user: req.user,
  });

  const prescription = await Prescription.findById(dispense.prescriptionId);
  if (prescription) {
    for (const item of dispense.items) {
      const line = prescription.items.id(item.prescriptionItemId);
      if (line) line.quantityDispensed = Math.max(0, line.quantityDispensed - item.quantity);
    }
    prescription.refreshStatus();
    prescription.updatedBy = req.user._id;
    await prescription.save();
  }

  dispense.returnedAt = new Date();
  dispense.returnedBy = req.user._id;
  dispense.returnReason = req.body.reason;
  dispense.updatedBy = req.user._id;
  await dispense.save();

  await dispense.populate(DISPENSE_POPULATE);
  return sendResponse(res, {
    message: 'Stock returned to its batches',
    data: dispense,
    meta: { prescriptionStatus: prescription?.status },
  });
});
