import { randomUUID } from 'node:crypto';

const HEADER = 'x-request-id';

/** Honour an inbound id if it looks like a token, otherwise mint one. */
export function createRequestId(incoming) {
  if (typeof incoming === 'string' && /^[\w-]{8,128}$/.test(incoming)) return incoming;
  return randomUUID();
}

/**
 * Stamp every request with an id, echo it on the response, and make it
 * available to logs and the audit trail as `req.id`.
 */
export function requestId(req, res, next) {
  const id = createRequestId(req.get(HEADER));
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export default requestId;
