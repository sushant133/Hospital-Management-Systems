import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { PatientPortalAccount, Patient } from '../models/index.js';

export function signPortalAccess(account) {
  return jwt.sign(
    { sub: String(account._id), typ: 'portal', tokenVersion: account.tokenVersion ?? 0 },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn },
  );
}

export function signPortalRefresh(account) {
  return jwt.sign(
    { sub: String(account._id), typ: 'portal', tokenVersion: account.tokenVersion ?? 0 },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn },
  );
}

export const requirePortalAuth = asyncHandler(async (req, _res, next) => {
  const token =
    req.cookies?.[config.cookie.portalAccessName] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null);
  if (!token) throw ApiError.unauthorized('Portal sign-in required', { code: 'NO_TOKEN' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token expired', { code: 'TOKEN_EXPIRED' });
    }
    throw ApiError.unauthorized('Invalid access token', { code: 'INVALID_TOKEN' });
  }
  if (payload.typ !== 'portal') {
    throw ApiError.unauthorized('Staff session cannot use the patient portal', { code: 'WRONG_SESSION' });
  }

  const account = await PatientPortalAccount.findById(payload.sub);
  if (!account || !account.isActive) {
    throw ApiError.unauthorized('Portal account is no longer active', { code: 'ACCOUNT_INACTIVE' });
  }
  if ((account.tokenVersion ?? 0) !== (payload.tokenVersion ?? 0)) {
    throw ApiError.unauthorized('Session has been revoked', { code: 'TOKEN_REVOKED' });
  }

  const patient = await Patient.findById(account.patientId);
  if (!patient || !patient.isActive || patient.status === 'merged') {
    throw ApiError.unauthorized('Patient record is not available', { code: 'PATIENT_INACTIVE' });
  }

  req.portalAccount = account;
  req.portalPatient = patient;
  next();
});

export default requirePortalAuth;
