import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestId } from '../../src/middleware/requestId.js';

describe('createRequestId', () => {
  it('accepts a well-formed inbound id', () => {
    assert.equal(createRequestId('abc-12345-request'), 'abc-12345-request');
  });

  it('rejects junk and mints a uuid instead', () => {
    const minted = createRequestId('nope');
    assert.match(minted, /^[0-9a-f-]{36}$/i);
    assert.notEqual(createRequestId(''), minted);
  });
});
