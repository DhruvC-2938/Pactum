/**
 * Unit tests for the Bulletproof-style range proof module — Issue #190
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict),
 * matching the existing test style in the project.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fiatShamirChallenge,
  generateRangeProof,
  verifyRangeProof,
  PEDERSEN_P,
  PEDERSEN_G,
  PEDERSEN_H,
  RATING_MIN,
  RATING_MAX,
  RangeProof,
} from './bulletproof';
import { modPow } from './paillier';

// Use the compact modulus as the pkN in all tests.
const PK_N = PEDERSEN_P;

// ---------------------------------------------------------------------------
// fiatShamirChallenge
// ---------------------------------------------------------------------------

test('fiatShamirChallenge is deterministic', () => {
  const c1 = fiatShamirChallenge(999n, PK_N);
  const c2 = fiatShamirChallenge(999n, PK_N);
  assert.equal(c1, c2);
});

test('fiatShamirChallenge is never zero', () => {
  const seeds = [0n, 1n, 100n, PK_N / 2n, PK_N - 1n];
  for (const seed of seeds) {
    const c = fiatShamirChallenge(seed, PK_N);
    assert.notEqual(c, 0n, `challenge should not be 0 for seed ${seed}`);
  }
});

test('fiatShamirChallenge is less than PEDERSEN_P', () => {
  for (const seed of [42n, 12345n, PK_N - 2n]) {
    const c = fiatShamirChallenge(seed, PK_N);
    assert.ok(c < PEDERSEN_P, `challenge ${c} should be < PEDERSEN_P`);
  }
});

test('fiatShamirChallenge changes when commitment changes', () => {
  const c1 = fiatShamirChallenge(100n, PK_N);
  const c2 = fiatShamirChallenge(101n, PK_N);
  assert.notEqual(c1, c2);
});

// ---------------------------------------------------------------------------
// generateRangeProof / verifyRangeProof — valid ratings
// ---------------------------------------------------------------------------

for (const rating of [1n, 2n, 3n, 4n, 5n]) {
  test(`valid proof for rating ${rating} verifies`, () => {
    const blinding = 12345n + rating;
    const proof = generateRangeProof(rating, blinding, PK_N);

    assert.ok(verifyRangeProof(proof, PK_N), `proof for rating ${rating} should verify`);
  });
}

test('proof commitment is a valid Pedersen commitment C = g^v · h^r mod p', () => {
  const rating = 3n;
  const blinding = 99999n;
  const proof = generateRangeProof(rating, blinding, PK_N);

  const p = PEDERSEN_P;
  const expected = (modPow(PEDERSEN_G, rating, p) * modPow(PEDERSEN_H, blinding, p)) % p;
  assert.equal(proof.commitment, expected);
});

// ---------------------------------------------------------------------------
// Rejection of out-of-range ratings
// ---------------------------------------------------------------------------

test('generateRangeProof throws for rating 0 (below minimum)', () => {
  assert.throws(() => generateRangeProof(0n, 1n, PK_N), RangeError);
});

test('generateRangeProof throws for rating 6 (above maximum)', () => {
  assert.throws(() => generateRangeProof(6n, 1n, PK_N), RangeError);
});

// ---------------------------------------------------------------------------
// Tampered proofs must not verify
// ---------------------------------------------------------------------------

test('tampered witnessA fails verification', () => {
  const proof = generateRangeProof(3n, 12345n, PK_N);
  const tampered: RangeProof = { ...proof, witnessA: proof.witnessA + 1n };
  assert.equal(verifyRangeProof(tampered, PK_N), false);
});

test('tampered witnessB fails verification', () => {
  const proof = generateRangeProof(3n, 12345n, PK_N);
  const tampered: RangeProof = { ...proof, witnessB: proof.witnessB + 1n };
  assert.equal(verifyRangeProof(tampered, PK_N), false);
});

test('tampered commitment fails verification', () => {
  const proof = generateRangeProof(3n, 12345n, PK_N);
  const tampered: RangeProof = { ...proof, commitment: proof.commitment + 1n };
  assert.equal(verifyRangeProof(tampered, PK_N), false);
});

test('zeroed witnesses fail verification', () => {
  const proof = generateRangeProof(3n, 12345n, PK_N);
  const tampered: RangeProof = { ...proof, witnessA: 0n, witnessB: 0n };
  assert.equal(verifyRangeProof(tampered, PK_N), false);
});

// ---------------------------------------------------------------------------
// Cross-proof: witness from one rating does not verify for another commitment
// ---------------------------------------------------------------------------

test('witness from rating 3 does not satisfy commitment for rating 4', () => {
  const proofFor3 = generateRangeProof(3n, 12345n, PK_N);
  const proofFor4 = generateRangeProof(4n, 12345n, PK_N);

  // Swap the commitment: witnesses from proof-3 against commitment-4.
  const tampered: RangeProof = {
    commitment: proofFor4.commitment,
    witnessA: proofFor3.witnessA,
    witnessB: proofFor3.witnessB,
  };
  assert.equal(verifyRangeProof(tampered, PK_N), false);
});

// ---------------------------------------------------------------------------
// Different blinding factors produce different commitments for same rating
// ---------------------------------------------------------------------------

test('distinct blinding factors produce distinct commitments', () => {
  const p1 = generateRangeProof(3n, 100n, PK_N);
  const p2 = generateRangeProof(3n, 200n, PK_N);
  assert.notEqual(p1.commitment, p2.commitment);
  // Both should still verify.
  assert.ok(verifyRangeProof(p1, PK_N));
  assert.ok(verifyRangeProof(p2, PK_N));
});
