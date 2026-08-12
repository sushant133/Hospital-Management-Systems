import ApiError from '../utils/ApiError.js';

/** Terminal 404 for unmatched routes — hands off to the error handler. */
export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, {
    code: 'ROUTE_NOT_FOUND',
  }));
}

export default notFound;
