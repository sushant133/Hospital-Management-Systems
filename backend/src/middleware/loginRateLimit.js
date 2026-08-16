import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * IP-level backstop for credential stuffing. Account lockout (lockoutService)
 * covers repeated failures against a *known* email; this covers the spray
 * against addresses that do not exist, which we deliberately do not persist.
 *
 * Skipped in `test` so the permission and login suites do not trip it.
 */
export const loginRateLimit = rateLimit({
  windowMs: config.auth.rateLimitWindowMs,
  limit: config.auth.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  handler(req, _res, next) {
    next(
      ApiError.tooManyRequests(
        'Too many sign-in attempts from this address. Try again later.',
        { code: 'RATE_LIMITED' },
      ),
    );
  },
});

export default loginRateLimit;
