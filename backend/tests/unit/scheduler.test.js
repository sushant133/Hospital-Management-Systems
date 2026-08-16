import '../helpers/env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { msUntilHour } from '../../src/jobs/scheduler.js';

describe('msUntilHour', () => {
  it('returns the gap to the same hour tomorrow when it has already passed', () => {
    const now = new Date('2026-08-15T03:00:00');
    const wait = msUntilHour(2, now);
    const target = new Date(now.getTime() + wait);
    assert.equal(target.getHours(), 2);
    assert.ok(wait > 20 * 60 * 60 * 1000);
  });

  it('returns a short wait when the hour is still ahead today', () => {
    const now = new Date('2026-08-15T01:00:00');
    const wait = msUntilHour(2, now);
    assert.ok(wait > 0 && wait <= 60 * 60 * 1000);
  });
});
