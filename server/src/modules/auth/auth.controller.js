import config from '../../config/index.js';
import User from '../../models/User.js';
import ApiError from '../../utils/ApiError.js';
import asyncHandler from '../../utils/asyncHandler.js';
import sendResponse from '../../utils/sendResponse.js';
import { permissionsForRole } from '../../config/permissions.js';
import { recordAudit } from '../../middleware/audit.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../middleware/auth.js';

/** Common fields for an authentication audit entry. */
function authAuditBase(req) {
  return {
    module: 'auth',
    resourceType: 'User',
    method: req.method,
    path: req.originalUrl,
    ipAddress: req.ip,
    userAgent: req.get?.('user-agent'),
  };
}

const baseCookieOptions = {
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: 'strict',
  path: '/',
  ...(config.cookie.domain ? { domain: config.cookie.domain } : {}),
};

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(config.cookie.accessName, accessToken, {
    ...baseCookieOptions,
    maxAge: config.cookie.accessMaxAgeMs,
  });
  res.cookie(config.cookie.refreshName, refreshToken, {
    ...baseCookieOptions,
    maxAge: config.cookie.refreshMaxAgeMs,
  });
}

function clearAuthCookies(res) {
  res.clearCookie(config.cookie.accessName, baseCookieOptions);
  res.clearCookie(config.cookie.refreshName, baseCookieOptions);
}

/** Shape the user object sent to the client. Never includes passwordHash. */
function publicUser(user) {
  return {
    id: user._id,
    employeeId: user.employeeId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    departmentId: user.departmentId,
    specialization: user.specialization,
    licenseNumber: user.licenseNumber,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * POST /auth/login
 * Public. Returns the user and sets httpOnly access + refresh cookies.
 * The access token is also returned in the body for non-browser clients.
 */
export const login = asyncHandler(async (req, res) => {
  const { email: emailInput, password: passwordInput } = req.body;

  // +passwordHash because the field is select:false on the schema.
  const user = await User.findOne({ email: emailInput }).select('+passwordHash');

  // Same message and code for "no such user" and "wrong password" so the
  // endpoint cannot be used to enumerate valid accounts.
  const invalid = ApiError.unauthorized('Invalid email or password', {
    code: 'INVALID_CREDENTIALS',
  });

  if (!user) {
    // Burn roughly the same time as a real bcrypt comparison would.
    await User.hashPassword('timing-equalizer');
    // The address is recorded, not the password — repeated failures against an
    // unknown address are how credential stuffing shows up in the trail.
    await recordAudit({
      ...authAuditBase(req),
      action: 'login_failed',
      outcome: 'failure',
      statusCode: 401,
      reason: 'No account for this email address',
      changes: { email: emailInput },
    });
    throw invalid;
  }

  const passwordMatches = await user.verifyPassword(passwordInput);
  if (!passwordMatches) {
    await recordAudit({
      ...authAuditBase(req),
      action: 'login_failed',
      outcome: 'failure',
      statusCode: 401,
      userId: user._id,
      userName: `${user.firstName} ${user.lastName}`.trim(),
      userRole: user.role,
      resourceId: user._id,
      reason: 'Incorrect password',
    });
    throw invalid;
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated. Contact an administrator.', {
      code: 'ACCOUNT_INACTIVE',
    });
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  setAuthCookies(res, { accessToken, refreshToken });

  await recordAudit({
    ...authAuditBase(req),
    action: 'login',
    outcome: 'success',
    statusCode: 200,
    userId: user._id,
    userName: `${user.firstName} ${user.lastName}`.trim(),
    userRole: user.role,
    resourceId: user._id,
    resourceRef: user.employeeId,
  });

  return sendResponse(res, {
    message: 'Signed in successfully',
    data: {
      user: publicUser(user),
      permissions: permissionsForRole(user.role),
      accessToken,
    },
  });
});

/**
 * POST /auth/refresh
 * Public (the refresh cookie IS the credential). Rotates both tokens.
 */
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[config.cookie.refreshName] || req.body?.refreshToken;
  if (!token) {
    throw ApiError.unauthorized('No refresh token provided', { code: 'NO_REFRESH_TOKEN' });
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    clearAuthCookies(res);
    throw ApiError.unauthorized('Refresh token is invalid or expired', {
      code: 'INVALID_REFRESH_TOKEN',
    });
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    clearAuthCookies(res);
    throw ApiError.unauthorized('Account is no longer active', { code: 'ACCOUNT_INACTIVE' });
  }

  if ((user.tokenVersion ?? 0) !== (payload.tokenVersion ?? 0)) {
    clearAuthCookies(res);
    throw ApiError.unauthorized('Session has been revoked. Please sign in again.', {
      code: 'TOKEN_REVOKED',
    });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user); // rotate on every use
  setAuthCookies(res, { accessToken, refreshToken });

  return sendResponse(res, {
    message: 'Session refreshed',
    data: {
      user: publicUser(user),
      permissions: permissionsForRole(user.role),
      accessToken,
    },
  });
});

/** POST /auth/logout — clears cookies. Safe to call when already signed out. */
export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookies(res);
  return sendResponse(res, { message: 'Signed out successfully', data: null });
});

/**
 * GET /auth/me — current session user. Used to bootstrap the client.
 *
 * Ships the caller's effective permissions alongside the user, derived from the
 * server's matrix. The client therefore never keeps its own copy of the
 * authorization rules — it asks. See ARCHITECTURE.md §4.
 */
export const me = asyncHandler(async (req, res) => {
  await req.user.populate({ path: 'departmentId', select: 'code name' });
  return sendResponse(res, {
    data: {
      user: { ...publicUser(req.user), department: req.user.departmentId },
      permissions: permissionsForRole(req.user.role),
    },
  });
});

/**
 * POST /auth/change-password
 * Bumps tokenVersion, which revokes every other outstanding session, then
 * issues a fresh pair so the current device stays signed in.
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found');

  const matches = await user.verifyPassword(currentPassword);
  if (!matches) {
    throw ApiError.unauthorized('Current password is incorrect', {
      code: 'INVALID_CREDENTIALS',
    });
  }

  user.passwordHash = await User.hashPassword(newPassword);
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.updatedBy = user._id;
  await user.save();

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  setAuthCookies(res, { accessToken, refreshToken });

  await recordAudit({
    ...authAuditBase(req),
    action: 'password_change',
    outcome: 'success',
    statusCode: 200,
    userId: user._id,
    userName: `${user.firstName} ${user.lastName}`.trim(),
    userRole: user.role,
    resourceId: user._id,
    resourceRef: user.employeeId,
  });

  return sendResponse(res, {
    message: 'Password changed successfully. Other sessions have been signed out.',
    data: {
      user: publicUser(user),
      permissions: permissionsForRole(user.role),
      accessToken,
    },
  });
});

export { publicUser };
