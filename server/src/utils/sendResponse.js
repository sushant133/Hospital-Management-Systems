/**
 * Uniform success envelope:
 *   { success: true, message?, data, meta? }
 *
 * Errors use the mirrored shape from errorHandler.js:
 *   { success: false, error: { code, message, details? } }
 */
export function sendResponse(res, { statusCode = 200, message, data = null, meta } = {}) {
  const payload = { success: true };
  if (message) payload.message = message;
  payload.data = data;
  if (meta) payload.meta = meta;
  return res.status(statusCode).json(payload);
}

export function sendCreated(res, { message, data, meta } = {}) {
  return sendResponse(res, { statusCode: 201, message, data, meta });
}

export default sendResponse;
