import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_TRUST_SCORE, trustScore } from '../src/score.ts';

describe('trustScore', () => {
  it('scores a spotless history at the maximum', () => {
    assert.equal(trustScore({ fulfilled: 12, late: 0, breached: 0 }), MAX_TRUST_SCORE);
  });

  it('scores an address with no settled commitments at zero', () => {
    assert.equal(trustScore({ fulfilled: 0, late: 0, breached: 0 }), 0);
  });

  it('halves the contribution of a late outcome', () => {
    assert.equal(trustScore({ fulfilled: 0, late: 4, breached: 0 }), 500);
  });

  it('gives a breach no credit at all', () => {
    assert.equal(trustScore({ fulfilled: 0, late: 0, breached: 3 }), 0);
  });

  it('weights a mixed history proportionally', () => {
    // (10 * 1000 + 2 * 500) / 13 = 846.15… → 846
    assert.equal(trustScore({ fulfilled: 10, late: 2, breached: 1 }), 846);
  });

  it('floors rather than rounds, so the score never overstates a history', () => {
    // (2 * 1000 + 0) / 3 = 666.67 → 666
    assert.equal(trustScore({ fulfilled: 2, late: 0, breached: 1 }), 666);
  });

  it('rejects non-integer or negative counts', () => {
    assert.throws(() => trustScore({ fulfilled: 1.5, late: 0, breached: 0 }));
    assert.throws(() => trustScore({ fulfilled: -1, late: 0, breached: 0 }));
  });
});
