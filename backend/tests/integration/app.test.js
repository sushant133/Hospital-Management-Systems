import '../helpers/env.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Boots the Express app (no listen) so CI catches a wiring typo the same way
 * `createApp()` does at process start. Does not open Mongo.
 */
describe('createApp', () => {
  let app;

  before(async () => {
    const mod = await import('../../src/app.js');
    app = mod.createApp();
  });

  it('builds an Express app', () => {
    assert.equal(typeof app.listen, 'function');
    assert.equal(typeof app.handle, 'function');
  });
});
