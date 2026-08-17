import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MerkleTree } from '../src/relayer/merkleTree';
import { StateProofGenerator } from '../src/relayer/stateProofGenerator';
import { RelayerService } from '../src/relayer/relayerService';
import { verifyPactumStateProof } from '../src/relayer/verifier';
import { pactumStateProofSchema, ScoreData } from '../src/schemas/stateProof';

describe('Zero-Trust Oracle Relayer and State Proofs', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const stellarAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const networkPassphrase = 'Test SDF Network ; September 2015';

  const scoreData: ScoreData = {
    score: 92,
    fulfilledCount: 25,
    lateCount: 2,
    breachedCount: 0,
    epoch: 3,
    sourceLedgerSeq: 12000,
  };

  describe('MerkleTree', () => {
    it('builds a binary tree and generates verifiable proofs for all leaves', () => {
      const leaves = [
        Buffer.from('11'.repeat(32), 'hex'),
        Buffer.from('22'.repeat(32), 'hex'),
        Buffer.from('33'.repeat(32), 'hex'),
        Buffer.from('44'.repeat(32), 'hex'),
      ];

      const tree = new MerkleTree(leaves);
      const root = tree.getRoot();

      assert.ok(root);
      assert.equal(root.length, 32);

      for (let i = 0; i < leaves.length; i++) {
        const proof = tree.getProof(i);
        const isValid = MerkleTree.verify(leaves[i], proof, root);
        assert.equal(isValid, true);
      }
    });

    it('handles odd number of leaves gracefully by duplicating the last node', () => {
      const leaves = [
        Buffer.from('aa'.repeat(32), 'hex'),
        Buffer.from('bb'.repeat(32), 'hex'),
        Buffer.from('cc'.repeat(32), 'hex'),
      ];

      const tree = new MerkleTree(leaves);
      const root = tree.getRoot();

      for (let i = 0; i < leaves.length; i++) {
        const proof = tree.getProof(i);
        assert.equal(MerkleTree.verify(leaves[i], proof, root), true);
      }
    });
  });

  describe('StateProofGenerator and RelayerService', () => {
    let generator: StateProofGenerator;
    let relayerService: RelayerService;

    beforeEach(() => {
      generator = new StateProofGenerator({
        contractId,
        networkPassphrase,
      });

      relayerService = new RelayerService({
        contractId,
        networkPassphrase,
        pollIntervalMs: 1000,
      });
    });

    it('generates a valid, schema-compliant PactumStateProof', async () => {
      generator.setScoreData(stellarAddress, scoreData);

      const proof = await generator.generateProof(stellarAddress, {
        targetLedgerSeq: 12050,
      });

      // Assert schema compliance
      const parsed = pactumStateProofSchema.parse(proof);
      assert.equal(parsed.version, '1.0.0');
      assert.equal(parsed.stellarAddress, stellarAddress);
      assert.equal(parsed.scoreData.score, 92);

      // Verify cryptographically
      const result = verifyPactumStateProof(proof);
      assert.equal(result.valid, true);
      assert.equal(result.score, 92);
      assert.equal(result.ledgerSeq, 12050);
    });

    it('relayer service caches and serves generated state proofs', async () => {
      relayerService.updateScore(stellarAddress, scoreData);

      const proof = await relayerService.getProofForAddress(stellarAddress);
      assert.ok(proof);
      assert.equal(proof.stellarAddress, stellarAddress);

      const verifyResult = verifyPactumStateProof(proof, proof.ledgerHeaderHash);
      assert.equal(verifyResult.valid, true);
      assert.equal(verifyResult.score, 92);
    });

    it('detects and rejects tampered scores or corrupted proof nodes', async () => {
      generator.setScoreData(stellarAddress, scoreData);
      const proof = await generator.generateProof(stellarAddress);

      // 1. Tampered score
      const tamperedProof = {
        ...proof,
        scoreData: {
          ...proof.scoreData,
          score: 100, // Tampered
        },
      };
      assert.equal(verifyPactumStateProof(tamperedProof).valid, false);

      // 2. Tampered sibling
      const corruptedProof = {
        ...proof,
        merkleProof: proof.merkleProof.map(node => ({
          ...node,
          sibling: '0x' + '00'.repeat(32),
        })),
      };
      if (proof.merkleProof.length > 0) {
        assert.equal(verifyPactumStateProof(corruptedProof).valid, false);
      }
    });

    it('start and stop lifecycle functions execute cleanly', () => {
      relayerService.start();
      relayerService.stop();
    });
  });
});
