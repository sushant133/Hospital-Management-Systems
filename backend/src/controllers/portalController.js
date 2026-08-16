import { PatientPortalAccount, Patient, Appointment, LabOrder, RadiologyOrder, Invoice } from '../models/index.js';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { generateSlots, assertSlotAvailable } from '../services/appointmentService.js';
import { notify } from '../services/notificationService.js';
import { signPortalAccess, signPortalRefresh } from '../middleware/portalAuth.js';
import { isLocked, registerFailedLogin, registerSuccessfulLogin } from '../services/lockoutService.js';

const cookieBase = {
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: 'strict',
  path: '/',
  ...(config.cookie.domain ? { domain: config.cookie.domain } : {}),
};

function setPortalCookies(res, { accessToken, refreshToken }) {
  res.cookie(config.cookie.portalAccessName, accessToken, { ...cookieBase, maxAge: config.cookie.accessMaxAgeMs });
  res.cookie(config.cookie.portalRefreshName, refreshToken, { ...cookieBase, maxAge: config.cookie.refreshMaxAgeMs });
}

function clearPortalCookies(res) {
  res.clearCookie(config.cookie.portalAccessName, cookieBase);
  res.clearCookie(config.cookie.portalRefreshName, cookieBase);
}

function publicPortal(account, patient) {
  return {
    accountId: account._id,
    email: account.email,
    mustChangePassword: account.mustChangePassword,
    patient: {
      id: patient._id,
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
    },
  };
}

export const invite = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient || !patient.isActive) throw ApiError.notFound('Patient not found');
  const email = (req.body.email || patient.email || '').toLowerCase().trim();
  if (!email) throw ApiError.badRequest('An email is required to open a portal account');

  const existing = await PatientPortalAccount.findOne({ patientId: patient._id });
  if (existing) {
    throw ApiError.conflict('This chart already has a portal account', { code: 'PORTAL_EXISTS' });
  }

  const password = req.body.password;
  const account = await PatientPortalAccount.create({
    patientId: patient._id,
    email,
    passwordHash: await PatientPortalAccount.hashPassword(password),
    mustChangePassword: true,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  if (!patient.email) {
    patient.email = email;
    await patient.save();
  }
  return sendCreated(res, {
    message: 'Portal account created',
    data: { email: account.email, patientId: patient._id },
  });
});

export const login = asyncHandler(async (req, res) => {
  const account = await PatientPortalAccount.findOne({ email: req.body.email.toLowerCase() }).select(
    '+passwordHash',
  );
  if (!account) {
    throw ApiError.unauthorized('Incorrect email or password', { code: 'INVALID_CREDENTIALS' });
  }
  if (isLocked(account)) {
    throw ApiError.tooManyRequests('Portal account is locked. Try again later.', { code: 'ACCOUNT_LOCKED' });
  }
  const ok = await account.comparePassword(req.body.password);
  if (!ok) {
    await registerFailedLogin(account);
    throw ApiError.unauthorized('Incorrect email or password', { code: 'INVALID_CREDENTIALS' });
  }
  await registerSuccessfulLogin(account);
  const patient = await Patient.findById(account.patientId);
  if (!patient || !patient.isActive) {
    throw ApiError.unauthorized('Patient record is not available');
  }
  const accessToken = signPortalAccess(account);
  const refreshToken = signPortalRefresh(account);
  setPortalCookies(res, { accessToken, refreshToken });
  return sendResponse(res, { message: 'Signed in', data: { ...publicPortal(account, patient), accessToken } });
});

export const me = asyncHandler(async (req, res) => {
  return sendResponse(res, { data: publicPortal(req.portalAccount, req.portalPatient) });
});

export const logout = asyncHandler(async (req, res) => {
  clearPortalCookies(res);
  return sendResponse(res, { message: 'Signed out', data: null });
});

export const myAppointments = asyncHandler(async (req, res) => {
  const rows = await Appointment.find({ patientId: req.portalPatient._id, isActive: true })
    .populate({ path: 'doctorId', select: 'firstName lastName specialization' })
    .populate({ path: 'departmentId', select: 'code name' })
    .sort({ scheduledStart: -1 })
    .limit(50)
    .lean();
  return sendResponse(res, { data: rows });
});

export const listDoctors = asyncHandler(async (_req, res) => {
  const { User } = await import('../models/index.js');
  const rows = await User.find({ role: 'doctor', isActive: true })
    .select('firstName lastName specialization departmentId')
    .populate({ path: 'departmentId', select: 'code name' })
    .limit(50)
    .lean();
  return sendResponse(res, { data: rows });
});

export const mySlots = asyncHandler(async (req, res) => {
  if (!req.query.doctorId || !req.query.date) {
    throw ApiError.badRequest('doctorId and date are required');
  }
  const slots = await generateSlots({ doctorId: req.query.doctorId, date: new Date(req.query.date) });
  return sendResponse(res, { data: slots });
});

export const bookAppointment = asyncHandler(async (req, res) => {
  const start = new Date(req.body.scheduledStart);
  const end = new Date(req.body.scheduledEnd);
  if (!(end > start)) throw ApiError.badRequest('End must be after start');
  const durationMinutes = Math.max(5, Math.round((end - start) / 60000));
  await assertSlotAvailable({ doctorId: req.body.doctorId, start, end });
  const appointment = await Appointment.create({
    patientId: req.portalPatient._id,
    doctorId: req.body.doctorId,
    departmentId: req.body.departmentId,
    scheduledStart: start,
    scheduledEnd: end,
    durationMinutes,
    type: req.body.type || 'consultation',
    reason: req.body.reason || 'Patient portal booking',
    status: 'scheduled',
  });
  void notify({
    userId: req.body.doctorId,
    type: 'appointment',
    title: 'Portal booking',
    body: `${req.portalPatient.firstName} ${req.portalPatient.lastName} booked via the portal`,
    patientId: req.portalPatient._id,
    resourceType: 'Appointment',
    resourceId: appointment._id,
  });
  return sendCreated(res, { message: 'Appointment requested', data: appointment });
});

export const myResults = asyncHandler(async (req, res) => {
  const [lab, radiology] = await Promise.all([
    LabOrder.find({ patientId: req.portalPatient._id, status: 'completed', isActive: true })
      .select('orderNumber status completedAt tests reportPath')
      .sort({ completedAt: -1 })
      .limit(30)
      .lean(),
    RadiologyOrder.find({ patientId: req.portalPatient._id, status: 'completed', isActive: true })
      .select('orderNumber status completedAt name modality reportPath')
      .sort({ completedAt: -1 })
      .limit(30)
      .lean(),
  ]);
  return sendResponse(res, { data: { lab, radiology } });
});

export const myInvoices = asyncHandler(async (req, res) => {
  const rows = await Invoice.find({
    patientId: req.portalPatient._id,
    isActive: true,
    status: { $ne: 'void' },
  })
    .select('invoiceNumber status total balance issuedAt')
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  return sendResponse(res, { data: rows });
});
