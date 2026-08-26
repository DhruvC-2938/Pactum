"use strict";
/**
 * Unit tests for the Bulletproof-style range proof module — Issue #190
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict),
 * matching the existing test style in the project.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const bulletproof_1 = require("./bulletproof");
const paillier_1 = require("./paillier");
// Use the compact modulus as the pkN in all tests.
const PK_N = bulletproof_1.PEDERSEN_P;
// ---------------------------------------------------------------------------
// fiatShamirChallenge
// ---------------------------------------------------------------------------
(0, node_test_1.test)('fiatShamirChallenge is deterministic', () => {
    const c1 = (0, bulletproof_1.fiatShamirChallenge)(999n, PK_N);
    const c2 = (0, bulletproof_1.fiatShamirChallenge)(999n, PK_N);
    strict_1.default.equal(c1, c2);
});
(0, node_test_1.test)('fiatShamirChallenge is never zero', () => {
    const seeds = [0n, 1n, 100n, PK_N / 2n, PK_N - 1n];
    for (const seed of seeds) {
        const c = (0, bulletproof_1.fiatShamirChallenge)(seed, PK_N);
        strict_1.default.notEqual(c, 0n, `challenge should not be 0 for seed ${seed}`);
    }
});
(0, node_test_1.test)('fiatShamirChallenge is less than PEDERSEN_P', () => {
    for (const seed of [42n, 12345n, PK_N - 2n]) {
        const c = (0, bulletproof_1.fiatShamirChallenge)(seed, PK_N);
        strict_1.default.ok(c < bulletproof_1.PEDERSEN_P, `challenge ${c} should be < PEDERSEN_P`);
    }
});
(0, node_test_1.test)('fiatShamirChallenge changes when commitment changes', () => {
    const c1 = (0, bulletproof_1.fiatShamirChallenge)(100n, PK_N);
    const c2 = (0, bulletproof_1.fiatShamirChallenge)(101n, PK_N);
    strict_1.default.notEqual(c1, c2);
});
// ---------------------------------------------------------------------------
// generateRangeProof / verifyRangeProof — valid ratings
// ---------------------------------------------------------------------------
for (const rating of [1n, 2n, 3n, 4n, 5n]) {
    (0, node_test_1.test)(`valid proof for rating ${rating} verifies`, () => {
        const blinding = 12345n + rating;
        const proof = (0, bulletproof_1.generateRangeProof)(rating, blinding, PK_N);
        strict_1.default.ok((0, bulletproof_1.verifyRangeProof)(proof, PK_N), `proof for rating ${rating} should verify`);
    });
}
(0, node_test_1.test)('proof commitment is a valid Pedersen commitment C = g^v · h^r mod p', () => {
    const rating = 3n;
    const blinding = 99999n;
    const proof = (0, bulletproof_1.generateRangeProof)(rating, blinding, PK_N);
    const p = bulletproof_1.PEDERSEN_P;
    const expected = ((0, paillier_1.modPow)(bulletproof_1.PEDERSEN_G, rating, p) * (0, paillier_1.modPow)(bulletproof_1.PEDERSEN_H, blinding, p)) % p;
    strict_1.default.equal(proof.commitment, expected);
});
// ---------------------------------------------------------------------------
// Rejection of out-of-range ratings
// ---------------------------------------------------------------------------
(0, node_test_1.test)('generateRangeProof throws for rating 0 (below minimum)', () => {
    strict_1.default.throws(() => (0, bulletproof_1.generateRangeProof)(0n, 1n, PK_N), RangeError);
});
(0, node_test_1.test)('generateRangeProof throws for rating 6 (above maximum)', () => {
    strict_1.default.throws(() => (0, bulletproof_1.generateRangeProof)(6n, 1n, PK_N), RangeError);
});
// ---------------------------------------------------------------------------
// Tampered proofs must not verify
// ---------------------------------------------------------------------------
(0, node_test_1.test)('tampered witnessA fails verification', () => {
    const proof = (0, bulletproof_1.generateRangeProof)(3n, 12345n, PK_N);
    const tampered = { ...proof, witnessA: proof.witnessA + 1n };
    strict_1.default.equal((0, bulletproof_1.verifyRangeProof)(tampered, PK_N), false);
});
(0, node_test_1.test)('tampered witnessB fails verification', () => {
    const proof = (0, bulletproof_1.generateRangeProof)(3n, 12345n, PK_N);
    const tampered = { ...proof, witnessB: proof.witnessB + 1n };
    strict_1.default.equal((0, bulletproof_1.verifyRangeProof)(tampered, PK_N), false);
});
(0, node_test_1.test)('tampered commitment fails verification', () => {
    const proof = (0, bulletproof_1.generateRangeProof)(3n, 12345n, PK_N);
    const tampered = { ...proof, commitment: proof.commitment + 1n };
    strict_1.default.equal((0, bulletproof_1.verifyRangeProof)(tampered, PK_N), false);
});
(0, node_test_1.test)('zeroed witnesses fail verification', () => {
    const proof = (0, bulletproof_1.generateRangeProof)(3n, 12345n, PK_N);
    const tampered = { ...proof, witnessA: 0n, witnessB: 0n };
    strict_1.default.equal((0, bulletproof_1.verifyRangeProof)(tampered, PK_N), false);
});
// ---------------------------------------------------------------------------
// Cross-proof: witness from one rating does not verify for another commitment
// ---------------------------------------------------------------------------
(0, node_test_1.test)('witness from rating 3 does not satisfy commitment for rating 4', () => {
    const proofFor3 = (0, bulletproof_1.generateRangeProof)(3n, 12345n, PK_N);
    const proofFor4 = (0, bulletproof_1.generateRangeProof)(4n, 12345n, PK_N);
    // Swap the commitment: witnesses from proof-3 against commitment-4.
    const tampered = {
        commitment: proofFor4.commitment,
        witnessA: proofFor3.witnessA,
        witnessB: proofFor3.witnessB,
    };
    strict_1.default.equal((0, bulletproof_1.verifyRangeProof)(tampered, PK_N), false);
});
// ---------------------------------------------------------------------------
// Different blinding factors produce different commitments for same rating
// ---------------------------------------------------------------------------
(0, node_test_1.test)('distinct blinding factors produce distinct commitments', () => {
    const p1 = (0, bulletproof_1.generateRangeProof)(3n, 100n, PK_N);
    const p2 = (0, bulletproof_1.generateRangeProof)(3n, 200n, PK_N);
    strict_1.default.notEqual(p1.commitment, p2.commitment);
    // Both should still verify.
    strict_1.default.ok((0, bulletproof_1.verifyRangeProof)(p1, PK_N));
    strict_1.default.ok((0, bulletproof_1.verifyRangeProof)(p2, PK_N));
});
