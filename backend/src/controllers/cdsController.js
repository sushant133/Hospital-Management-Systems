import asyncHandler from '../utils/asyncHandler.js';
import sendResponse from '../utils/sendResponse.js';
import { discovery, patientView } from '../services/cdsService.js';

export const listServices = asyncHandler(async (_req, res) => {
  res.json(discovery());
});

export const runPatientView = asyncHandler(async (req, res) => {
  const context = req.body.context ?? req.body;
  const result = await patientView({
    patientId: context.patientId,
    encounterId: context.encounterId,
  });
  return sendResponse(res, { data: result });
});
