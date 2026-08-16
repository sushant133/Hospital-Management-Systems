import { LabOrder, LabResult, LabTest, Patient } from '../models/index.js';
import { can, MODULES } from '../config/permissions.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendCreated } from '../utils/sendResponse.js';
import { parseOru } from '../services/hl7Service.js';
import { buildResultValues } from '../services/labService.js';
import { notify } from '../services/notificationService.js';

/**
 * POST /lab/inbound/hl7
 *
 * Accepts a raw HL7 v2 ORU^R01 (text/plain) or JSON `{ message }`. Matches the
 * placer/filler order number to a lab order and writes preliminary results
 * for every analyte that exists on the ordered test.
 */
export const ingestOru = asyncHandler(async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : req.body?.message;
  if (!raw || !String(raw).trim()) {
    throw ApiError.badRequest('HL7 message is empty', { code: 'EMPTY_HL7' });
  }

  let parsed;
  try {
    parsed = parseOru(raw);
  } catch (error) {
    throw ApiError.badRequest(error.message, { code: 'HL7_PARSE_FAILED' });
  }

  if (parsed.sendingApplication) {
    const { Device } = await import('../models/index.js');
    await Device.updateOne(
      { sendingApplication: parsed.sendingApplication, isActive: true },
      { $set: { lastSeenAt: new Date() } },
    );
  }

  const orderNumber = parsed.placerOrderNumber || parsed.fillerOrderNumber;
  if (!orderNumber) {
    throw ApiError.badRequest('ORU has no placer or filler order number', { code: 'HL7_NO_ORDER' });
  }

  const order = await LabOrder.findOne({
    orderNumber: orderNumber.toUpperCase(),
    isActive: true,
  });
  if (!order) {
    throw ApiError.notFound(`No lab order matches ${orderNumber}`, { code: 'ORDER_NOT_FOUND' });
  }
  if (order.status === 'cancelled') {
    throw ApiError.conflict('Cannot post results to a cancelled order', { code: 'ORDER_CANCELLED' });
  }

  if (parsed.patientMrn) {
    const patient = await Patient.findById(order.patientId).select('mrn').lean();
    if (patient?.mrn && patient.mrn.toUpperCase() !== parsed.patientMrn.toUpperCase()) {
      throw ApiError.conflict(
        `HL7 patient ${parsed.patientMrn} does not match order ${patient.mrn}`,
        { code: 'HL7_PATIENT_MISMATCH' },
      );
    }
  }

  const testCode = (parsed.testCode || '').toUpperCase();
  const ordered = testCode
    ? order.tests.find((t) => t.code.toUpperCase() === testCode)
    : order.tests.length === 1
      ? order.tests[0]
      : null;
  if (!ordered) {
    throw ApiError.badRequest(
      testCode
        ? `Test ${testCode} is not on order ${order.orderNumber}`
        : 'ORU does not name a test and the order has more than one',
      { code: 'HL7_TEST_MISMATCH' },
    );
  }

  const labTest = await LabTest.findById(ordered.labTestId).lean();
  if (!labTest) throw ApiError.badRequest('Catalogue entry for this test no longer exists');

  const validCodes = new Set(labTest.analytes.map((a) => a.code.toUpperCase()));
  const entries = parsed.observations
    .filter((obs) => validCodes.has((obs.analyteCode || '').toUpperCase()))
    .map((obs) => ({
      analyteCode: obs.analyteCode,
      value: obs.value,
      notes: obs.abnormalFlags || '',
    }));

  if (!entries.length) {
    throw ApiError.badRequest('No OBX analytes match this test catalogue', { code: 'HL7_NO_ANALYTES' });
  }

  const values = buildResultValues(labTest, entries);
  const wantsVerified = can(req.user.role, MODULES.LAB_RESULTS, 'verify');

  const existing = await LabResult.findOne({ labOrderId: order._id, labTestId: labTest._id });
  if (existing && existing.status === 'verified') {
    throw ApiError.conflict('This result is already verified. Amend it in the worklist.', {
      code: 'RESULT_ALREADY_VERIFIED',
    });
  }

  const payload = {
    labOrderId: order._id,
    patientId: order.patientId,
    encounterId: order.encounterId,
    labTestId: labTest._id,
    testCode: labTest.code,
    testName: labTest.name,
    values,
    technicianNotes: `Ingested from HL7 ORU ${parsed.messageControlId || ''}`.trim(),
    interpretation: '',
    status: wantsVerified ? 'verified' : 'preliminary',
    performedBy: req.user._id,
    verifiedBy: wantsVerified ? req.user._id : null,
    verifiedAt: wantsVerified ? new Date() : null,
    updatedBy: req.user._id,
  };

  let result;
  if (existing) {
    Object.assign(existing, payload);
    result = await existing.save();
  } else {
    result = await LabResult.create({ ...payload, createdBy: req.user._id });
  }

  if (order.status === 'ordered' || order.status === 'collected') {
    order.status = 'in-progress';
    order.startedAt = order.startedAt ?? new Date();
    order.updatedBy = req.user._id;
    await order.save();
  }

  if (result.hasCriticalValues && order.orderedBy) {
    void notify({
      userId: order.orderedBy,
      type: 'lab-critical',
      title: `Critical lab values on ${order.orderNumber}`,
      body: `${result.testName} posted via HL7 has one or more critical values.`,
      patientId: order.patientId,
      resourceType: 'LabOrder',
      resourceId: order._id,
    });
  }

  return sendCreated(res, {
    message: `Posted ${entries.length} analyte(s) to ${order.orderNumber}`,
    data: {
      orderNumber: order.orderNumber,
      resultId: result._id,
      status: result.status,
      hasCriticalValues: result.hasCriticalValues,
      parsed: {
        messageControlId: parsed.messageControlId,
        patientMrn: parsed.patientMrn,
        testCode: parsed.testCode,
      },
    },
  });
});
