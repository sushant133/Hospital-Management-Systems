import mongoose from 'mongoose';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Centralized error handler — the single place that turns any thrown value into
 * an HTTP response. Stack traces are logged server-side but NEVER sent to the
 * client in production.
 *
 * Response shape (mirrors the success envelope in utils/sendResponse.js):
 *   { success: false, error: { code, message, details? } }
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity (4 args)
export function errorHandler(err, req, res, _next) {
  let normalized = err;

  if (!(normalized instanceof ApiError)) {
    normalized = normalizeKnownError(err);
  }

  const isServerError = normalized.statusCode >= 500;

  // Log everything server-side; include the stack for real failures.
  const logLine = `[error] ${req.method} ${req.originalUrl} -> ${normalized.statusCode} ${normalized.code}: ${normalized.message}`;
  if (isServerError) {
    console.error(logLine, '\n', err?.stack || err);
  } else {
    console.warn(logLine);
  }

  const body = {
    success: false,
    error: {
      code: normalized.code,
      // Never leak an unexpected internal message to the client in production.
      message:
        isServerError && config.isProduction
          ? 'An unexpected error occurred. Please try again later.'
          : normalized.message,
    },
  };

  if (normalized.details) body.error.details = normalized.details;
  if (!config.isProduction && err?.stack) body.error.stack = err.stack.split('\n');

  res.status(normalized.statusCode).json(body);
}

/** Map framework/driver errors onto our ApiError vocabulary. */
function normalizeKnownError(err) {
  // Mongoose schema validation
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return ApiError.validation('Validation failed', details);
  }

  // Malformed ObjectId etc.
  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for '${err.path}'`, { code: 'INVALID_ID' });
  }

  // Duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    return ApiError.conflict(`A record with this ${field} already exists`, {
      code: 'DUPLICATE_KEY',
      details: [{ field, message: 'Must be unique' }],
    });
  }

  // JWT
  if (err?.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Token expired', { code: 'TOKEN_EXPIRED' });
  }
  if (err?.name === 'JsonWebTokenError') {
    return ApiError.unauthorized('Invalid token', { code: 'INVALID_TOKEN' });
  }

  // Malformed JSON body (body-parser)
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return ApiError.badRequest('Request body is not valid JSON', { code: 'MALFORMED_JSON' });
  }

  // Anything else is a bug.
  return new ApiError(err?.statusCode || 500, err?.message || 'Internal server error');
}

export default errorHandler;
