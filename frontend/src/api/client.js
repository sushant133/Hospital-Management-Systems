/**
 * Same-origin, so the httpOnly SameSite=Strict auth cookies ride along without
 * any cross-site configuration. Exported because a few places build a URL the
 * browser navigates to directly (report CSV downloads) rather than fetching, and
 * those must not carry a second copy of this string.
 */
export const BASE_URL = '/api/v1';

/**
 * Error thrown by every failed request. Carries the server's structured error
 * so forms can map `details` onto individual fields.
 */
export class ApiRequestError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** { fieldName: 'message' } for form-level display. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((acc, item) => {
      if (item?.field && !acc[item.field]) acc[item.field] = item.message;
      return acc;
    }, {});
  }
}

/** Registered by AuthContext so a 401 can clear session state app-wide. */
let onUnauthenticated = null;
export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = handler;
}

// Ensures concurrent 401s trigger only ONE refresh call.
let refreshPromise = null;

async function attemptRefresh() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        // Release the lock on the next tick so queued callers see the result.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(path, { method = 'GET', body, params, signal, _retried } = {}) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers = body ? { 'Content-Type': 'application/json' } : {};

  const response = await fetch(url.toString().replace(window.location.origin, ''), {
    method,
    credentials: 'include', // send the httpOnly auth cookies
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const payload = await parseBody(response);

  if (response.ok) return payload;

  const error = payload?.error ?? {};

  // Access token expired — refresh once, then replay the original request.
  if (response.status === 401 && error.code === 'TOKEN_EXPIRED' && !_retried) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return request(path, { method, body, params, signal, _retried: true });
    }
  }

  // Any other 401 means the session is genuinely gone.
  if (response.status === 401 && path !== '/auth/login' && path !== '/portal/auth/login') {
    onUnauthenticated?.();
  }

  throw new ApiRequestError(error.message || `Request failed (${response.status})`, {
    status: response.status,
    code: error.code,
    details: error.details,
  });
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
