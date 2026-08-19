/**
 * Tests for the semantic half of verification — the checks that run before the
 * pairing check and do not need compiled artifacts. Every case here is one that
 * short-circuits before `groth16.verify` is reached; the cryptographic half, and the
 * cases that get past these checks, are covered against real proofs in circuit.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Groth16Proof } from '../src/prove.ts';
import {
  PUBLIC_SIGNAL_ORDER,
  parsePublicSignals,
  verifyTrustThresholdProof,
  type VerificationKey,
} from '../src/verify.ts';

// Never reached: every case here is rejected before the pairing check.
const UNUSED_PROOF = {} as Groth16Proof;
const UNUSED_VKEY = { protocol: 'groth16', curve: 'bn128', nPublic: 3 } as VerificationKey;

const ROOT = 12345678901234567890n;
const CONTEXT = 777n;

/** `[aboveThreshold, root, threshold, contextId]`. */
function signals(aboveThreshold: bigint, root: bigint, threshold: bigint, context: bigint) {
  return [aboveThreshold, root, threshold, context].map(String);
}

function verify(publicSignals: string[]) {
  return verifyTrustThresholdProof({
    proof: UNUSED_PROOF,
    publicSignals,
    verificationKey: UNUSED_VKEY,
    expectedRoot: ROOT,
    minThreshold: 800n,
    expectedContextId: CONTEXT,
  });
}

describe('parsePublicSignals', () => {
  it('names the signals in the order circom emits them', () => {
    assert.deepEqual(PUBLIC_SIGNAL_ORDER, ['aboveThreshold', 'root', 'threshold', 'contextId']);

    const parsed = parsePublicSignals(signals(1n, ROOT, 800n, CONTEXT));
    assert.deepEqual(parsed, {
      aboveThreshold: 1n,
      root: ROOT,
      threshold: 800n,
      contextId: CONTEXT,
    });
  });

  it('rejects a signal list of the wrong length', () => {
    assert.throws(() => parsePublicSignals(['1', '2']), /Expected 4 public signals/);
  });
});

describe('verifyTrustThresholdProof semantic checks', () => {
  it('reports a malformed signal list rather than throwing', async () => {
    const result = await verify(['1']);
    assert.equal(result.valid, false);
    assert.match((result as { reason: string }).reason, /Expected 4 public signals/);
  });

  it('rejects a proof that does not assert the threshold was cleared', async () => {
    const result = await verify(signals(0n, ROOT, 800n, CONTEXT));
    assert.equal(result.valid, false);
    assert.match((result as { reason: string }).reason, /does not assert/);
  });

  it('rejects a stale snapshot root', async () => {
    const result = await verify(signals(1n, ROOT + 1n, 800n, CONTEXT));
    assert.equal(result.valid, false);
    assert.match((result as { reason: string }).reason, /different reputation snapshot/);
  });

  it('rejects a threshold below what the verifier requires', async () => {
    const result = await verify(signals(1n, ROOT, 799n, CONTEXT));
    assert.equal(result.valid, false);
    assert.match((result as { reason: string }).reason, /below the required/);
  });

  it('rejects a proof bound to another verifier context', async () => {
    const result = await verify(signals(1n, ROOT, 800n, CONTEXT + 1n));
    assert.equal(result.valid, false);
    assert.match((result as { reason: string }).reason, /different context/);
  });
});
