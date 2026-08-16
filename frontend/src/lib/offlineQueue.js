/**
 * ============================================================================
 * OFFLINE TOLERANCE (D4)
 * ============================================================================
 *
 * Power cuts and connectivity gaps are routine outside the Kathmandu Valley.
 * The previous behaviour was an honest banner — "you are offline, writes will
 * fail" — which is an accurate description and an unacceptable one: a pharmacy
 * counter or an OPD registration desk cannot simply stop.
 *
 * ---------------------------------------------------------------------------
 * THE SCOPE IS DELIBERATELY NARROW
 * ---------------------------------------------------------------------------
 * Full offline-first is expensive and, for clinical data, dangerous — two
 * nurses charting the same patient on two disconnected tablets produce a merge
 * nobody can safely resolve. So only operations that are genuinely
 * append-only and independent are queued:
 *
 *   QUEUED   registration, OPD token issue, payment capture, dispense record
 *   REFUSED  anything clinical — orders, results, prescriptions, admissions
 *
 * A clinician who cannot chart is told plainly. That is worse than charting,
 * and much better than charting into a void that silently conflicts later.
 *
 * ---------------------------------------------------------------------------
 * EVERY QUEUED REQUEST CARRIES AN IDEMPOTENCY KEY
 * ---------------------------------------------------------------------------
 * The queue drains by replaying requests, and a replay that the server already
 * processed must not charge the patient twice. The key is minted when the
 * request is queued, not when it is sent, so a retry reuses it — which is
 * exactly what the server-side middleware (D1) is built to recognise.
 */

const DB_NAME = 'hms-offline';
const STORE = 'outbox';
const DB_VERSION = 1;

/** Endpoints safe to queue. Everything else fails loudly while offline. */
const QUEUEABLE = [
  { method: 'POST', pattern: /^\/patients$/ },
  { method: 'POST', pattern: /^\/queue\/tokens$/ },
  { method: 'POST', pattern: /^\/invoices\/[^/]+\/payments$/ },
  { method: 'POST', pattern: /^\/pharmacy\/dispense/ },
  { method: 'POST', pattern: /^\/attendance/ },
];

export function isQueueable(method, path) {
  return QUEUEABLE.some((rule) => rule.method === method.toUpperCase() && rule.pattern.test(path));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('queuedAt', 'queuedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const tx = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
};

/** A key stable across retries — the whole point of minting it here. */
const newIdempotencyKey = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Queue a write for later.
 * Returns the stored entry so the UI can show it as pending — never as done.
 */
export async function enqueue({ method, path, body, label }) {
  const entry = {
    method: method.toUpperCase(),
    path,
    body,
    label: label || `${method} ${path}`,
    idempotencyKey: newIdempotencyKey(),
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: '',
  };

  await tx('readwrite', (store) => store.add(entry));
  return entry;
}

export async function pending() {
  return tx('readonly', (store) => store.getAll());
}

export async function pendingCount() {
  return (await pending()).length;
}

/**
 * Drain the outbox.
 *
 * Strictly in order and stops at the first failure. Later entries may depend on
 * earlier ones — a payment against a patient registered in the same offline
 * spell — and racing ahead would produce errors that look like data corruption.
 *
 * A 4xx means the server understood and rejected it; retrying forever would
 * block the queue behind one bad request, so those are surfaced for a human and
 * removed. Only network and 5xx failures are retried.
 */
export async function drain(apiFetch) {
  const entries = (await pending()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

  const result = { sent: 0, failed: 0, rejected: [] };

  for (const entry of entries) {
    try {
      const response = await apiFetch(entry.path, {
        method: entry.method,
        body: entry.body,
        headers: { 'Idempotency-Key': entry.idempotencyKey },
      });

      await tx('readwrite', (store) => store.delete(entry.id));
      result.sent += 1;
      void response;
    } catch (error) {
      const status = error?.status ?? 0;

      if (status >= 400 && status < 500 && status !== 409) {
        // Permanently rejected. Keeping it would block everything behind it.
        await tx('readwrite', (store) => store.delete(entry.id));
        result.rejected.push({ label: entry.label, reason: error.message, body: entry.body });
        continue;
      }

      entry.attempts += 1;
      entry.lastError = error?.message ?? 'network error';
      await tx('readwrite', (store) => store.put(entry));
      result.failed += 1;
      // Stop: preserve ordering rather than pushing on past a gap.
      break;
    }
  }

  return result;
}

export async function discard(id) {
  return tx('readwrite', (store) => store.delete(id));
}

/**
 * Wire the queue to the browser's connectivity events.
 *
 * `onChange` is handed the pending count so the UI can show it permanently —
 * a cashier must never believe a bill saved when it is still sitting in an
 * outbox. That indicator is the most important part of this whole module.
 */
export function startOfflineSync({ apiFetch, onChange = () => {} }) {
  const notify = async () => onChange({ online: navigator.onLine, pending: await pendingCount() });

  const sync = async () => {
    if (!navigator.onLine) return notify();
    const result = await drain(apiFetch);
    await notify();
    return result;
  };

  window.addEventListener('online', sync);
  window.addEventListener('offline', notify);
  const timer = setInterval(sync, 30000);

  notify();

  return () => {
    window.removeEventListener('online', sync);
    window.removeEventListener('offline', notify);
    clearInterval(timer);
  };
}

export default { enqueue, pending, pendingCount, drain, discard, startOfflineSync, isQueueable };
