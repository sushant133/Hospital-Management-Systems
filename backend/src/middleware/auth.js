import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';

/** Read the access token from the httpOnly cookie, falling back to a Bearer header. */
export function extractAccessToken(req) {
  const fromCookie = req.cookies?.[config.cookie.accessName];
  if (fromCookie) return fromCookie;

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();

  return null;
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn },
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: String(user._id), tokenVersion: user.tokenVersion ?? 0 },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn },
  );
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

/**
 * Verifies the access token, loads the user, and attaches it to req.user.
 *
 * Rejects when: token missing/expired/tampered, user deleted or deactivated, or
 * tokenVersion no longer matches (password changed / session revoked).
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = extractAccessToken(req);
  if (!token) {
    throw ApiError.unauthorized('Authentication required', { code: 'NO_TOKEN' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      // The client uses this specific code to trigger a silent refresh.
      throw ApiError.unauthorized('Access token expired', { code: 'TOKEN_EXPIRED' });
    }
    throw ApiError.unauthorized('Invalid access token', { code: 'INVALID_TOKEN' });
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account is no longer active', { code: 'ACCOUNT_INACTIVE' });
  }

  if ((user.tokenVersion ?? 0) !== (payload.tokenVersion ?? 0)) {
    throw ApiError.unauthorized('Session has been revoked. Please sign in again.', {
      code: 'TOKEN_REVOKED',
    });
  }

  req.user = user;
  next();
});

export default requireAuth;
