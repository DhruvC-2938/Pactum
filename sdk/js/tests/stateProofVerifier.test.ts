import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import {
  verifyPactumStateProof,
  computeLeafHash,
  computeMerkleRoot,
  computeHeaderHash,
  addressToBytes32,
  bytesToHex,
  type PactumStateProof,
  type ScoreData,
} from '../src/index.js';

describe('Zero-Trust StateProofVerifier (TypeScript SDK)', () => {
  const defaultScoreData: ScoreData = {
    score: 85,
    fulfilledCount: 10,
    lateCount: 1,
    breachedCount: 0,
    epoch: 1,
    sourceLedgerSeq: 10450,
  };

  const sampleProof: PactumStateProof = {
    version: '1.0.0',
    networkPassphrase: 'Test SDF Network ; September 2015',
    ledgerSeq: 10500,
    ledgerHeaderHash: '0x',
    stateRootHash: '0x',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    scoreData: { ...defaultScoreData },
    leafHash: '',
    merkleProof: [],
    headerProof: {
      previousLedgerHash: '0x' + '11'.repeat(32),
      txSetResultHash: '0x' + '22'.repeat(32),
      bucketListHash: '',
      ledgerVersion: 21,
    },
  };

  // Helper to setup a valid proof with independent cloned scoreData
  function createValidProof(overrides: Partial<PactumStateProof> = {}): PactumStateProof {
    const scoreData: ScoreData = {
      ...defaultScoreData,
      ...(overrides.scoreData || {}),
    };

    const contractId = overrides.contractId || sampleProof.contractId;
    const stellarAddress = overrides.stellarAddress || sampleProof.stellarAddress;
    const ledgerSeq = overrides.ledgerSeq !== undefined ? overrides.ledgerSeq : sampleProof.ledgerSeq;

    const leaf = computeLeafHash(contractId, stellarAddress, scoreData);
    const leafHex = bytesToHex(leaf);

    const sibling1 = '0x' + 'ab'.repeat(32);
    const sibling2 = '0x' + 'cd'.repeat(32);
    const merkleProof = overrides.merkleProof || [
      { sibling: sibling1, isRight: true },
      { sibling: sibling2, isRight: false },
    ];

    const root = computeMerkleRoot(leaf, merkleProof);
    const rootHex = bytesToHex(root);

    const headerProof = {
      previousLedgerHash: '0x' + '11'.repeat(32),
      txSetResultHash: '0x' + '22'.repeat(32),
      bucketListHash: rootHex,
      ledgerVersion: 21,
      ...(overrides.headerProof || {}),
    };

    const headerHash = computeHeaderHash(ledgerSeq, headerProof);
    const headerHex = bytesToHex(headerHash);

    const { scoreData: _s, headerProof: _h, merkleProof: _m, ...restOverrides } = overrides;

    return {
      version: '1.0.0',
      networkPassphrase: sampleProof.networkPassphrase,
      ledgerSeq,
      ledgerHeaderHash: headerHex,
      stateRootHash: rootHex,
      contractId,
      stellarAddress,
      scoreData,
      leafHash: leafHex,
      merkleProof,
      headerProof,
      ...restOverrides,
    };
  }

  it('successfully verifies a valid cryptographic state proof against a trusted header', () => {
    const proof = createValidProof();
    const result = verifyPactumStateProof(proof, proof.ledgerHeaderHash);

    expect(result.valid).toBe(true);
    expect(result.score).toBe(85);
    expect(result.ledgerSeq).toBe(10500);
    expect(result.stellarAddress).toBe(sampleProof.stellarAddress);
    expect(result.contractId).toBe(sampleProof.contractId);
  });

  it('rejects a proof when trusted header anchor is omitted', () => {
    const proof = createValidProof();
    const result = verifyPactumStateProof(proof);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('anchor is required');
  });

  it('rejects a proof when trusted header hash does not match', () => {
    const proof = createValidProof();
    const wrongHeader = '0x' + '99'.repeat(32);
    const result = verifyPactumStateProof(proof, wrongHeader);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not match trusted hash');
  });

  it('rejects a proof with an unsupported version string', () => {
    const proof = createValidProof({ version: '2.0.0' as any });
    const result = verifyPactumStateProof(proof, proof.ledgerHeaderHash);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported proof version');
  });

  it('rejects a proof with tampered trust score', () => {
    const proof = createValidProof();
    const trustedHeader = proof.ledgerHeaderHash;
    proof.scoreData.score = 99; // Tampered

    const result = verifyPactumStateProof(proof, trustedHeader);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Leaf hash mismatch');
  });

  it('rejects a proof with tampered fulfilledCount', () => {
    const proof = createValidProof();
    const trustedHeader = proof.ledgerHeaderHash;
    proof.scoreData.fulfilledCount = 500; // Tampered

    const result = verifyPactumStateProof(proof, trustedHeader);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Leaf hash mismatch');
  });

  it('rejects a proof with corrupted Merkle siblings', () => {
    const proof = createValidProof();
    const trustedHeader = proof.ledgerHeaderHash;
    proof.merkleProof[0].sibling = '0x' + 'ff'.repeat(32); // Corrupted sibling

    const result = verifyPactumStateProof(proof, trustedHeader);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Merkle root mismatch');
  });

  it('rejects a proof when stateRootHash does not match bucketListHash in header proof', () => {
    const proof = createValidProof();
    const trustedHeader = proof.ledgerHeaderHash;
    proof.headerProof.bucketListHash = '0x' + 'ee'.repeat(32);

    const result = verifyPactumStateProof(proof, trustedHeader);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('bucketListHash does not match stateRootHash');
  });

  it('rejects a proof with corrupted ledger header hash', () => {
    const proof = createValidProof();
    const trustedHeader = '0x' + '44'.repeat(32);
    proof.ledgerHeaderHash = '0x' + '44'.repeat(32);

    const result = verifyPactumStateProof(proof, trustedHeader);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Ledger header hash mismatch');
  });

  it('correctly decodes Stellar G and C addresses to exact 32-byte buffers', () => {
    const gAddr = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const gBytes = addressToBytes32(gAddr);
    const expectedG = StrKey.decodeEd25519PublicKey(gAddr);
    expect(gBytes.length).toBe(32);
    expect(Array.from(gBytes)).toEqual(Array.from(expectedG));

    const cAddr = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
    const cBytes = addressToBytes32(cAddr);
    const expectedC = StrKey.decodeContract(cAddr);
    expect(cBytes.length).toBe(32);
    expect(Array.from(cBytes)).toEqual(Array.from(expectedC));
  });
});
