import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocked,
  registerFailedLogin,
  registerSuccessfulLogin,
} from '../../src/services/lockoutService.js';

describe('lockoutService', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('is unlocked when lockedUntil is missing or in the past', () => {
    assert.equal(isLocked({}, now), false);
    assert.equal(isLocked({ lockedUntil: new Date('2026-08-15T11:00:00.000Z') }, now), false);
  });

  it('is locked while lockedUntil is in the future', () => {
    assert.equal(isLocked({ lockedUntil: new Date('2026-08-15T12:01:00.000Z') }, now), true);
  });

  it('increments the counter and does not lock before the threshold', () => {
    const next = registerFailedLogin({ failedLoginCount: 3 }, { maxAttempts: 5, now });
    assert.equal(next.failedLoginCount, 4);
    assert.equal(next.justLocked, false);
    assert.equal(next.lockedUntil, null);
  });

  it('locks on the attempt that reaches the threshold', () => {
    const next = registerFailedLogin(
      { failedLoginCount: 4 },
      { maxAttempts: 5, lockMinutes: 15, now },
    );
    assert.equal(next.failedLoginCount, 5);
    assert.equal(next.justLocked, true);
    assert.equal(next.lockedUntil.getTime(), now.getTime() + 15 * 60 * 1000);
  });

  it('clears the counter on a successful sign-in', () => {
    assert.deepEqual(registerSuccessfulLogin(), { failedLoginCount: 0, lockedUntil: null });
  });
});
