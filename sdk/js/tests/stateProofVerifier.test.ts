import { describe, it, expect } from 'vitest';
import {
  verifyPactumStateProof,
  computeLeafHash,
  computeMerkleRoot,
  computeHeaderHash,
  addressToBytes32,
  type PactumStateProof,
} from '../src/index.js';

describe('Zero-Trust StateProofVerifier (TypeScript SDK)', () => {
  const sampleProof: PactumStateProof = {
    version: '1.0.0',
    networkPassphrase: 'Test SDF Network ; September 2015',
    ledgerSeq: 10500,
    ledgerHeaderHash: '0x',
    stateRootHash: '0x',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    scoreData: {
      score: 85,
      fulfilledCount: 10,
      lateCount: 1,
      breachedCount: 0,
      epoch: 1,
      sourceLedgerSeq: 10450,
    },
    leafHash: '',
    merkleProof: [],
    headerProof: {
      previousLedgerHash: '0x' + '11'.repeat(32),
      txSetResultHash: '0x' + '22'.repeat(32),
      bucketListHash: '',
      ledgerVersion: 21,
    },
  };

  // Helper to setup a valid proof
  function createValidProof(): PactumStateProof {
    const leaf = computeLeafHash(
      sampleProof.contractId,
      sampleProof.stellarAddress,
      sampleProof.scoreData
    );
    let leafHex = '0x';
    for (let i = 0; i < leaf.length; i++) {
      leafHex += leaf[i].toString(16).padStart(2, '0');
    }

    const sibling1 = '0x' + 'ab'.repeat(32);
    const sibling2 = '0x' + 'cd'.repeat(32);
    const merkleProof = [
      { sibling: sibling1, isRight: true },
      { sibling: sibling2, isRight: false },
    ];

    const root = computeMerkleRoot(leaf, merkleProof);
    let rootHex = '0x';
    for (let i = 0; i < root.length; i++) {
      rootHex += root[i].toString(16).padStart(2, '0');
    }

    const headerProof = {
      previousLedgerHash: '0x' + '11'.repeat(32),
      txSetResultHash: '0x' + '22'.repeat(32),
      bucketListHash: rootHex,
      ledgerVersion: 21,
    };

    const headerHash = computeHeaderHash(sampleProof.ledgerSeq, headerProof);
    let headerHex = '0x';
    for (let i = 0; i < headerHash.length; i++) {
      headerHex += headerHash[i].toString(16).padStart(2, '0');
    }

    return {
      ...sampleProof,
      leafHash: leafHex,
      merkleProof,
      stateRootHash: rootHex,
      headerProof,
      ledgerHeaderHash: headerHex,
    };
  }

  it('successfully verifies a valid cryptographic state proof', () => {
    const proof = createValidProof();
    const result = verifyPactumStateProof(proof);

    expect(result.valid).toBe(true);
    expect(result.score).toBe(85);
    expect(result.ledgerSeq).toBe(10500);
    expect(result.stellarAddress).toBe(sampleProof.stellarAddress);
    expect(result.contractId).toBe(sampleProof.contractId);
  });

  it('successfully verifies against a trusted ledger header hash', () => {
    const proof = createValidProof();
    const result = verifyPactumStateProof(proof, proof.ledgerHeaderHash);

    expect(result.valid).toBe(true);
    expect(result.score).toBe(85);
  });

  it('rejects a proof when trusted header hash does not match', () => {
    const proof = createValidProof();
    const wrongHeader = '0x' + '99'.repeat(32);
    const result = verifyPactumStateProof(proof, wrongHeader);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not match trusted hash');
  });

  it('rejects a proof with tampered trust score', () => {
    const proof = createValidProof();
    proof.scoreData.score = 99; // Tampered

    const result = verifyPactumStateProof(proof);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Leaf hash mismatch');
  });

  it('rejects a proof with tampered fulfilledCount', () => {
    const proof = createValidProof();
    proof.scoreData.fulfilledCount = 500; // Tampered

    const result = verifyPactumStateProof(proof);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Leaf hash mismatch');
  });

  it('rejects a proof with corrupted Merkle siblings', () => {
    const proof = createValidProof();
    proof.merkleProof[0].sibling = '0x' + 'ff'.repeat(32); // Corrupted sibling

    const result = verifyPactumStateProof(proof);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Merkle root mismatch');
  });

  it('rejects a proof when stateRootHash does not match bucketListHash in header proof', () => {
    const proof = createValidProof();
    proof.headerProof.bucketListHash = '0x' + 'ee'.repeat(32);

    const result = verifyPactumStateProof(proof);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('bucketListHash does not match stateRootHash');
  });

  it('rejects a proof with corrupted ledger header hash', () => {
    const proof = createValidProof();
    proof.ledgerHeaderHash = '0x' + '44'.repeat(32);

    const result = verifyPactumStateProof(proof);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Ledger header hash mismatch');
  });

  it('correctly decodes Stellar G and C addresses to 32-byte buffers', () => {
    const gBytes = addressToBytes32('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    expect(gBytes.length).toBe(32);

    const cBytes = addressToBytes32('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM');
    expect(cBytes.length).toBe(32);
  });
});
