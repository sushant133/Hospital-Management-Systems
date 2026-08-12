/**
 * Operational error — one we produced deliberately and whose message is safe to
 * show a client. Anything that is NOT an ApiError is treated as a bug and its
 * message is suppressed in production.
 */
export class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || defaultCodeFor(statusCode);
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'You do not have permission to perform this action', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Resource not found', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'Resource already exists', options) {
    return new ApiError(409, message, options);
  }

  static validation(message = 'Validation failed', details) {
    return new ApiError(422, message, { code: 'VALIDATION_ERROR', details });
  }

  static internal(message = 'Internal server error', options) {
    return new ApiError(500, message, options);
  }
}

function defaultCodeFor(statusCode) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    }[statusCode] || 'ERROR'
  );
}

export default ApiError;
