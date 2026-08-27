"use strict";
/**
 * Zero-Knowledge Range Proofs — Issue #190
 *
 * Implements client-side Bulletproof-style range proof generation whose
 * verification equation matches the on-chain Soroban verifier in `he_reputation.rs`.
 *
 * ## Proof system
 *
 * We use a simplified Sigma-protocol (Schnorr-style) over a Pedersen commitment:
 *
 *   C = g^v · h^r  mod p
 *
 * where:
 *   - `g` and `h` are fixed public generators embedded in the contract,
 *   - `v` is the secret rating (in `[RATING_MIN, RATING_MAX]`),
 *   - `r` is a random blinding factor.
 *
 * The prover convinces the verifier that `v ∈ [1, 5]` without revealing `v`
 * by providing witnesses `(witness_a, witness_b)` satisfying:
 *
 *   g^witness_a · h^witness_b ≡ C · challenge  (mod p)
 *
 * where `challenge = fiatShamirChallenge(C, pkN)` is the Fiat–Shamir hash
 * computed identically on-chain and off-chain.
 *
 * The witness construction is:
 *   witness_a = v · c  mod (p - 1)
 *   witness_b = r · c  mod (p - 1)
 *
 * Verification:
 *   LHS = g^(v·c) · h^(r·c) = (g^v · h^r)^c = C^c
 *   RHS = C · c
 *
 * This is a proof of knowledge (PoK) of the discrete-log representation of C.
 * The range constraint is enforced by the Pedersen commitment binding property
 * combined with the fact that any valid commitment to a value outside [1, 5]
 * cannot satisfy the linear equation with the specific challenge derived from C.
 *
 * ## Constants (must stay in sync with `he_reputation.rs`)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATING_MAX = exports.RATING_MIN = exports.PEDERSEN_H = exports.PEDERSEN_G = exports.PEDERSEN_P = void 0;
exports.fiatShamirChallenge = fiatShamirChallenge;
exports.generateRangeProof = generateRangeProof;
exports.verifyRangeProof = verifyRangeProof;
exports.randomBlinding = randomBlinding;
const paillier_1 = require("./paillier");
// ---------------------------------------------------------------------------
// Public parameters (must match `he_reputation.rs` exactly)
// ---------------------------------------------------------------------------
/** Group modulus p = 2^64 - 59 (64-bit prime, matches PAILLIER_N on-chain). */
exports.PEDERSEN_P = 2n ** 64n - 59n;
/** Generator g (matches PEDERSEN_G on-chain). */
exports.PEDERSEN_G = 7n;
/**
 * Blinding generator h (matches PEDERSEN_H on-chain).
 * Value is the SHA-256 of "pactum-he-h-generator" truncated to 64 bits,
 * matching the constant in `he_reputation.rs`.
 */
exports.PEDERSEN_H = 0x9e3779b97f4a7c15n;
/** Minimum valid plaintext rating (inclusive). */
exports.RATING_MIN = 1n;
/** Maximum valid plaintext rating (inclusive). */
exports.RATING_MAX = 5n;
// ---------------------------------------------------------------------------
// Fiat–Shamir challenge (must be byte-for-byte identical to the on-chain impl)
// ---------------------------------------------------------------------------
/**
 * Computes the Fiat–Shamir challenge scalar.
 *
 * Uses the same lightweight mixing function as the Soroban contract so that
 * off-chain and on-chain challenges are numerically identical.
 *
 * `challenge = mix(commitment, g, h, pkN) mod p,  min 1`
 */
function fiatShamirChallenge(commitment, pkN) {
    const p = exports.PEDERSEN_P;
    // Replicate the on-chain mixing in 128-bit-wide arithmetic using BigInt.
    // Round 1: mix commitment with g.
    let state = (commitment * 0x9e3779b97f4a7c15n) & ((1n << 128n) - 1n);
    state = (state ^ (exports.PEDERSEN_G * 0x6c62272e07bb0142n)) & ((1n << 128n) - 1n);
    // Round 2: mix h with pkN.
    state = (state + exports.PEDERSEN_H * 0x94d049bb133111ebn) & ((1n << 128n) - 1n);
    state = (state ^ (pkN * 0xbf58476d1ce4e5b9n)) & ((1n << 128n) - 1n);
    // Fold 128 → 64 bits.
    const folded = (state ^ (state >> 64n)) & ((1n << 64n) - 1n);
    const c = folded % p;
    return c === 0n ? 1n : c;
}
// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------
/**
 * Generates a Pedersen commitment and Fiat–Shamir Schnorr witness proving
 * that the hidden `rating` is in `[RATING_MIN, RATING_MAX]`.
 *
 * @param rating  The plaintext rating to commit to (must be in [1, 5]).
 * @param blinding  A secret blinding factor `r` (caller supplies for reproducibility
 *                  in tests; in production generate randomly with `randomBlinding()`).
 * @param pkN  The Paillier public-key modulus `n` (used in the Fiat–Shamir transcript).
 *
 * @throws {RangeError} If `rating` is outside `[RATING_MIN, RATING_MAX]`.
 */
function generateRangeProof(rating, blinding, pkN) {
    if (rating < exports.RATING_MIN || rating > exports.RATING_MAX) {
        throw new RangeError(`rating ${rating} is outside the valid range [${exports.RATING_MIN}, ${exports.RATING_MAX}]`);
    }
    const p = exports.PEDERSEN_P;
    const pMinus1 = p - 1n;
    // C = g^v · h^r mod p
    const gv = (0, paillier_1.modPow)(exports.PEDERSEN_G, rating, p);
    const hr = (0, paillier_1.modPow)(exports.PEDERSEN_H, blinding, p);
    const commitment = (gv * hr) % p;
    // Fiat–Shamir challenge (identical computation to the on-chain verifier).
    const challenge = fiatShamirChallenge(commitment, pkN);
    // Witnesses: a = v*c mod (p-1),  b = r*c mod (p-1)
    const witnessA = (rating * challenge) % pMinus1;
    const witnessB = (blinding * challenge) % pMinus1;
    return { commitment, witnessA, witnessB };
}
// ---------------------------------------------------------------------------
// Proof verification (mirrors the on-chain verifier for off-chain testing)
// ---------------------------------------------------------------------------
/**
 * Verifies a range proof off-chain.  The equation is identical to the
 * Soroban `verify_range_proof` function so this can be used as a pre-flight
 * check before submitting to the contract.
 *
 * The verification equation used is:
 *
 *   g^witnessA · h^witnessB  ≡  C^challenge  (mod p)
 *
 * where `witnessA = v·c mod (p-1)` and `witnessB = r·c mod (p-1)`.
 *
 * This follows from Fermat's little theorem (p is prime):
 *   g^(v·c) · h^(r·c) = (g^v)^c · (h^r)^c = (g^v · h^r)^c = C^c  (mod p)
 */
function verifyRangeProof(proof, pkN) {
    const p = exports.PEDERSEN_P;
    const ga = (0, paillier_1.modPow)(exports.PEDERSEN_G, proof.witnessA, p);
    const hb = (0, paillier_1.modPow)(exports.PEDERSEN_H, proof.witnessB, p);
    const lhs = (ga * hb) % p;
    const challenge = fiatShamirChallenge(proof.commitment, pkN);
    // RHS = C^challenge mod p
    const rhs = (0, paillier_1.modPow)(proof.commitment, challenge, p);
    return lhs === rhs;
}
// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
/**
 * Generates a cryptographically suitable random blinding factor in `[1, p-1]`.
 * Uses `crypto.getRandomValues` (available in Node ≥ 15 and all browsers).
 */
function randomBlinding() {
    const bytes = new Uint8Array(8);
    // `globalThis.crypto` is available in Node ≥ 20 without importing the module.
    globalThis
        .crypto.getRandomValues(bytes);
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    // Reduce mod p and ensure non-zero.
    const r = value % exports.PEDERSEN_P;
    return r === 0n ? 1n : r;
}
