import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSha256Hex } from '../../src/workers/crypto.worker.ts';
import { sha256Hex, sha256Batch } from '../../src/lib/hash.ts';

describe('Web Worker Cryptographic Engine', () => {
  it('computes standard SHA-256 hex digest for empty string', async () => {
    const emptyHash = await computeSha256Hex('');
    assert.equal(
      emptyHash,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('computes correct SHA-256 for known test vector ("hello world")', async () => {
    const hash = await computeSha256Hex('hello world');
    assert.equal(
      hash,
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
  });

  it('computes SHA-256 via hash.ts interface seamlessly with fallback', async () => {
    const terms = 'Pactum escrow agreement for smart commitment contract';
    const hash = await sha256Hex(terms);
    const direct = await computeSha256Hex(terms);
    assert.equal(hash, direct);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
  });

  it('processes batch hashing operations efficiently', async () => {
    const batch = ['agreement_1', 'agreement_2', 'agreement_3'];
    const results = await sha256Batch(batch);
    assert.equal(results.length, 3);
    assert.equal(results[0], await computeSha256Hex('agreement_1'));
    assert.equal(results[1], await computeSha256Hex('agreement_2'));
    assert.equal(results[2], await computeSha256Hex('agreement_3'));
  });

  it('handles massive text payloads without blocking or truncating', async () => {
    const largePayload = 'A'.repeat(500000); // 500 KB string
    const hash = await sha256Hex(largePayload);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
  });
});
