/**
 * Wraps an async route handler so a rejected promise reaches the centralized
 * error middleware instead of hanging the request.
 *
 *   router.get('/', asyncHandler(async (req, res) => { ... }));
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
