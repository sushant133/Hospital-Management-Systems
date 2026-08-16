import '../helpers/env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * ============================================================================
 * TIER A ROUTE WIRING
 * ============================================================================
 *
 * Boots the real app and drives it over a real socket. No Mongo — every
 * assertion here is about *wiring*, and each one fails before a database is
 * ever reached:
 *
 *   - a route that is not mounted returns 404 from the not-found handler;
 *   - a route mounted behind `requireAuth` returns 401 without a token;
 *   - `requirePermission(module, action)` validates its pair at route-definition
 *     time, so a typo crashes `createApp()` and every test in this file fails at
 *     `before`, which is exactly the signal we want.
 *
 * The distinction that matters is 404 vs 401: both are "not 200", but only one
 * of them means the route exists.
 */

/** Where `createApp()` mounts the API. Keep in sync with src/app.js. */
const API_PREFIX = '/api/v1';

/** Start the app on an ephemeral port and return a tiny request helper. */
async function boot() {
  const { createApp } = await import('../../src/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const request = (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          // The API is mounted at /api/v1 (see app.js) — not /api.
          path: `${API_PREFIX}${path}`,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode, body: parsed });
          });
        },
      );
      req.on('error', reject);
      // A request that reaches Mongo will hang; nothing here should.
      req.setTimeout(4000, () => req.destroy(new Error('request timed out')));
      if (payload) req.write(payload);
      req.end();
    });

  return { server, request };
}

describe('Tier A/B/C route wiring', () => {
  let server;
  let request;

  before(async () => {
    // If any requirePermission pair is wrong, createApp() throws here and every
    // test below reports — which is the whole point of validating at boot.
    ({ server, request } = await boot());
  });

  after(() => server?.close());

  /**
   * Every Tier A endpoint, with the method it answers on.
   * Kept as a flat list so adding a route to the app without adding it here is
   * visible in review.
   */
  const PROTECTED_ROUTES = [
    ['GET', '/nepal/divisions'],
    ['GET', '/nepal/calendar'],
    ['GET', '/nepal/fiscal-years'],
    ['GET', '/nepal/identifier-types'],
    ['GET', '/nepal/local-levels?district=P3-D05'],
    ['GET', '/nepal/provinces/P3/districts'],
    ['GET', '/nepal/calendar/convert?ad=2024-07-16'],

    ['GET', '/schemes'],
    ['POST', '/schemes'],
    ['GET', '/entitlements'],
    ['POST', '/entitlements'],
    ['GET', '/entitlements/eligibility/check?patientId=000000000000000000000001'],
    ['GET', '/scheme-claims'],
    ['GET', '/scheme-claims/receivables'],

    ['GET', '/hib'],
    ['POST', '/hib'],
    ['GET', '/hib/eligibility?patientId=000000000000000000000001'],
    ['GET', '/hib/expiring'],

    ['GET', '/credit-notes'],
    ['POST', '/credit-notes'],
    ['GET', '/credit-notes/sequence-integrity'],

    ['GET', '/payments/gateway/providers'],
    ['POST', '/payments/gateway/initiate'],
    ['POST', '/payments/gateway/verify'],
    ['GET', '/payments/gateway/unsettled'],

    ['GET', '/sms'],
    ['POST', '/sms'],
    ['GET', '/sms/templates'],
    ['GET', '/sms/usage'],

    ['GET', '/hmis/returns'],
    ['POST', '/hmis/returns/generate'],
    ['GET', '/hmis/returns/indicators'],
    ['GET', '/hmis/returns/outstanding'],

    // Tier B — clinical safety and legal records
    ['GET', '/terminology/status'],
    ['GET', '/terminology/search?system=icd-10&q=pneu'],
    ['GET', '/critical-alerts/board'],
    ['GET', '/critical-alerts'],
    ['GET', '/controlled-drugs'],
    ['GET', '/controlled-drugs/discrepancies'],
    ['POST', '/controlled-drugs'],
    ['GET', '/medico-legal'],
    ['POST', '/medico-legal'],
    ['GET', '/death-records'],
    ['POST', '/death-records'],
    ['GET', '/birth-records'],
    ['GET', '/problems'],
    ['POST', '/problems'],
    ['GET', '/care-plans'],
    ['GET', '/infection-control/rates'],
    ['GET', '/infection-control/antibiogram'],
    ['GET', '/infection-control/isolations'],
    ['GET', '/stewardship'],
    ['GET', '/transfusions'],
    ['POST', '/transfusions'],
    ['GET', '/incidents'],
    ['GET', '/incidents/trends'],
    ['POST', '/incidents'],
    ['GET', '/complaints'],

    // Tier C — referrals and the operational modules
    ['GET', '/referrals'],
    ['GET', '/referrals/open-loop'],
    ['POST', '/referrals'],
    ['POST', '/queue/tokens'],
    ['POST', '/queue/call-next'],
    ['GET', '/ambulance'],
    ['GET', '/ambulance/trips'],
    ['POST', '/ambulance/trips'],
    ['GET', '/dialysis/machines'],
    ['GET', '/dialysis/unclaimed'],
    ['POST', '/dialysis/sessions'],
    ['GET', '/medical-records/files/overdue'],
    ['POST', '/medical-records/files/move'],
    ['GET', '/medical-records/releases'],
    ['GET', '/medical-records/coding'],
    ['GET', '/dietary/kitchen-count'],
    ['POST', '/dietary/orders'],
    ['GET', '/housekeeping'],
    ['POST', '/housekeeping'],
    ['GET', '/waste/report'],
    ['POST', '/waste'],
    ['POST', '/cssd/cycles'],
    ['GET', '/assets'],
    ['GET', '/assets/due'],
    ['POST', '/assets/faults'],
    ['GET', '/therapy'],
    ['POST', '/therapy'],
    ['GET', '/mortuary'],
    ['POST', '/mortuary'],
    ['GET', '/telemedicine'],
    ['POST', '/telemedicine'],
  ];

  it('mounts every Tier A, B and C route behind authentication', async () => {
    const notMounted = [];
    const notProtected = [];

    for (const [method, path] of PROTECTED_ROUTES) {
      const res = await request(method, path, method === 'POST' ? {} : null);

      // 404 means the path never matched a route — it is not mounted.
      if (res.status === 404) notMounted.push(`${method} ${path}`);
      // Anything other than 401 means an unauthenticated caller got past the
      // gate, which is far worse than a missing route.
      else if (res.status !== 401) notProtected.push(`${method} ${path} -> ${res.status}`);
    }

    assert.deepEqual(notMounted, [], 'routes that are not mounted');
    assert.deepEqual(notProtected, [], 'routes that did not demand authentication');
  });

  it('serves the OPD display board without a session, and leaks no identity', async () => {
    /**
     * The board runs on a television in the waiting hall. There is no user to
     * authenticate, and demanding one would just mean a permanently logged-in
     * account on a public screen — worse, not better.
     *
     * What makes it safe is the payload: token numbers and counters only. A
     * waiting room full of strangers must not learn who is being seen.
     */
    /**
     * No database is open here, so the handler reaches Mongo and stalls. That
     * stall IS the evidence: an authenticated route would have been rejected
     * with 401 by the middleware long before any query ran. A timeout therefore
     * proves the request got past the gate and into the controller.
     */
    let status = null;
    try {
      ({ status } = await request('GET', '/queue/board'));
    } catch (error) {
      assert.match(error.message, /timed out/, 'expected a stall at the database, not a transport error');
    }

    if (status !== null) {
      assert.notEqual(status, 401, 'the display board must not require a session');
      assert.notEqual(status, 404, 'the display board must be mounted');
    }
  });

  it('keeps patient identity off the public display board', async () => {
    /**
     * Asserted against the controller's own projection rather than over HTTP,
     * because the payload check is the part that needs a database and the
     * guarantee is too important to leave untested.
     *
     * A waiting room full of strangers must learn a token number and nothing
     * else — not a name, not an MRN, not why anyone is there.
     */
    const source = await import('node:fs').then((fs) =>
      fs.promises.readFile(new URL('../../src/controllers/operationsController.js', import.meta.url), 'utf8'));

    const board = source.slice(source.indexOf('export const displayBoard'), source.indexOf('export const updateToken'));

    // The token projection selects only non-identifying fields...
    assert.ok(
      board.includes("'tokenNumber priority departmentId'"),
      'the board must project only token number, priority and department',
    );
    // ...and the response maps to numbers rather than spreading the document.
    assert.ok(board.includes('upcoming: waiting.map'));
    for (const leak of ['firstName', 'lastName', 'mrn']) {
      assert.ok(!board.includes(leak), `the display board must not reference ${leak}`);
    }
  });

  it('answers the gateway webhook without authentication', async () => {
    // A payment gateway has no session and cannot authenticate. The handler is
    // safe because it trusts nothing in the payload beyond a reference — it
    // calls the provider back to ask whether money actually moved.
    //
    // Mounted OUTSIDE /payments on purpose: that mount applies requireAuth to
    // everything beneath it, so a nested webhook would 401 and the hospital
    // would stop hearing about completed payments.
    const res = await request('POST', '/webhooks/payment', { nothing: true });

    assert.notEqual(res.status, 401, 'the webhook must not require a session');
    assert.notEqual(res.status, 404, 'the webhook must be mounted');
    // Always 200: a gateway that receives an error retries for days.
    assert.equal(res.status, 200);
    assert.equal(res.body.received, true);
    assert.equal(res.body.acted, false, 'a payload with no reference must not settle anything');
  });

  it('does not expose a route to void an issued invoice', async () => {
    /**
     * Asserted against the route table rather than over HTTP, deliberately.
     *
     * `/invoices` sits behind `requireAuth`, so an unauthenticated probe of a
     * non-existent path under it answers 401 — indistinguishable from a path
     * that does exist. Only the router itself can answer "is this route
     * defined", and that is the fact worth pinning.
     *
     * The absence is the design: an issued invoice carries a number from an
     * unbroken fiscal-year sequence, IRD reads a gap as a suppressed sale, and
     * the only lawful reversal is a credit note.
     */
    const { default: apiRouter } = await import('../../src/routes/index.js');

    const paths = [];
    const walk = (stack) => {
      for (const layer of stack) {
        if (layer.route) paths.push(layer.route.path);
        else if (layer.handle?.stack) walk(layer.handle.stack);
      }
    };
    walk(apiRouter.stack);

    const voidRoutes = paths.filter((p) => /void/i.test(p));
    assert.deepEqual(voidRoutes, [], 'no route anywhere may void an invoice');

    // And the replacement exists: a draft may still be abandoned.
    assert.ok(paths.includes('/:id/cancel'), 'draft invoices must still be cancellable');
  });

  it('does not leak which endpoints exist to an unauthenticated caller', async () => {
    // A path under an authenticated mount answers 401, not 404, because
    // `requireAuth` runs before routing resolves. That is the right order: a
    // 404/401 split would let anyone map the API surface without a token.
    const underAuth = await request('GET', '/nepal/not-a-real-endpoint');
    assert.equal(underAuth.status, 401);

    // A path under no mount at all is a genuine 404.
    const nowhere = await request('GET', '/not-a-mounted-prefix/at-all');
    assert.equal(nowhere.status, 404);
  });
});
