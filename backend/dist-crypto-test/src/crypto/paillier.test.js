"use strict";
/**
 * Unit tests for the Paillier PHE module — Issue #190
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
const paillier_1 = require("./paillier");
// ---------------------------------------------------------------------------
// modPow
// ---------------------------------------------------------------------------
(0, node_test_1.test)('modPow: 2^10 mod 1024 = 0', () => {
    strict_1.default.equal((0, paillier_1.modPow)(2n, 10n, 1024n), 0n);
});
(0, node_test_1.test)('modPow: 3^4 mod 100 = 81', () => {
    strict_1.default.equal((0, paillier_1.modPow)(3n, 4n, 100n), 81n);
});
(0, node_test_1.test)('modPow: x^0 mod m = 1', () => {
    strict_1.default.equal((0, paillier_1.modPow)(999n, 0n, 101n), 1n);
});
(0, node_test_1.test)('modPow: 0^k mod m = 0', () => {
    strict_1.default.equal((0, paillier_1.modPow)(0n, 5n, 7n), 0n);
});
(0, node_test_1.test)('modPow: any x mod 1 = 0', () => {
    strict_1.default.equal((0, paillier_1.modPow)(99999n, 99999n, 1n), 0n);
});
// ---------------------------------------------------------------------------
// modInverse
// ---------------------------------------------------------------------------
(0, node_test_1.test)('modInverse: 3 * 3^-1 ≡ 1 (mod 7)', () => {
    const inv = (0, paillier_1.modInverse)(3n, 7n);
    strict_1.default.equal((3n * inv) % 7n, 1n);
});
(0, node_test_1.test)('modInverse: throws when gcd(a,m) ≠ 1', () => {
    strict_1.default.throws(() => (0, paillier_1.modInverse)(2n, 4n), /no inverse/);
});
// ---------------------------------------------------------------------------
// Key generation from small primes (fast, deterministic)
// ---------------------------------------------------------------------------
const P = 61n; // small safe prime
const Q = 53n;
const keyPair = (0, paillier_1.keyPairFromPrimes)(P, Q);
const { publicKey } = keyPair;
(0, node_test_1.test)('keyPairFromPrimes: n = p * q', () => {
    strict_1.default.equal(publicKey.n, P * Q);
});
(0, node_test_1.test)('keyPairFromPrimes: g = n + 1', () => {
    strict_1.default.equal(publicKey.g, publicKey.n + 1n);
});
(0, node_test_1.test)('keyPairFromPrimes: nSquared = n^2', () => {
    strict_1.default.equal(publicKey.nSquared, publicKey.n * publicKey.n);
});
// ---------------------------------------------------------------------------
// Encrypt / Decrypt round-trip
// ---------------------------------------------------------------------------
(0, node_test_1.test)('encrypt/decrypt round-trip for m = 0', () => {
    const ct = (0, paillier_1.encrypt)(publicKey, 0n, 2n);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, ct), 0n);
});
(0, node_test_1.test)('encrypt/decrypt round-trip for m = 42', () => {
    const ct = (0, paillier_1.encrypt)(publicKey, 42n, 3n);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, ct), 42n);
});
(0, node_test_1.test)('encrypt/decrypt round-trip for m = n - 1 (max plaintext)', () => {
    const m = publicKey.n - 1n;
    const ct = (0, paillier_1.encrypt)(publicKey, m, 5n);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, ct), m);
});
(0, node_test_1.test)('encrypt throws for negative plaintext', () => {
    strict_1.default.throws(() => (0, paillier_1.encrypt)(publicKey, -1n, 2n), RangeError);
});
(0, node_test_1.test)('encrypt throws for plaintext >= n', () => {
    strict_1.default.throws(() => (0, paillier_1.encrypt)(publicKey, publicKey.n, 2n), RangeError);
});
// ---------------------------------------------------------------------------
// Additive homomorphism: Enc(a) * Enc(b) = Enc(a+b) mod n²
// ---------------------------------------------------------------------------
(0, node_test_1.test)('encAdd: Enc(3) + Enc(4) decrypts to 7', () => {
    const ctA = (0, paillier_1.encrypt)(publicKey, 3n, 2n);
    const ctB = (0, paillier_1.encrypt)(publicKey, 4n, 3n);
    const ctSum = (0, paillier_1.encAdd)(publicKey, ctA, ctB);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, ctSum), 7n);
});
(0, node_test_1.test)('encAdd is commutative', () => {
    const ctA = (0, paillier_1.encrypt)(publicKey, 5n, 2n);
    const ctB = (0, paillier_1.encrypt)(publicKey, 8n, 3n);
    strict_1.default.equal((0, paillier_1.encAdd)(publicKey, ctA, ctB), (0, paillier_1.encAdd)(publicKey, ctB, ctA));
});
(0, node_test_1.test)('encAdd accumulates across three ciphertexts', () => {
    const ct1 = (0, paillier_1.encrypt)(publicKey, 1n, 2n);
    const ct2 = (0, paillier_1.encrypt)(publicKey, 2n, 3n);
    const ct3 = (0, paillier_1.encrypt)(publicKey, 3n, 4n);
    const sum = (0, paillier_1.encAdd)(publicKey, (0, paillier_1.encAdd)(publicKey, ct1, ct2), ct3);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, sum), 6n);
});
// ---------------------------------------------------------------------------
// Scalar multiplication: Enc(v)^k = Enc(v*k)
// ---------------------------------------------------------------------------
(0, node_test_1.test)('encScale: Enc(3) scaled by 4 decrypts to 12', () => {
    const ct = (0, paillier_1.encrypt)(publicKey, 3n, 2n);
    const scaled = (0, paillier_1.encScale)(publicKey, ct, 4n);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, scaled), 12n);
});
(0, node_test_1.test)('encScale by 0 yields Enc(0)', () => {
    const ct = (0, paillier_1.encrypt)(publicKey, 7n, 2n);
    const scaled = (0, paillier_1.encScale)(publicKey, ct, 0n);
    strict_1.default.equal((0, paillier_1.decrypt)(keyPair, scaled), 0n);
});
(0, node_test_1.test)('encScale by 1 is identity', () => {
    const ct = (0, paillier_1.encrypt)(publicKey, 13n, 2n);
    strict_1.default.equal((0, paillier_1.encScale)(publicKey, ct, 1n), ct);
});
// ---------------------------------------------------------------------------
// Negation: Enc(v) + Enc(-v) = Enc(0) mod n
// ---------------------------------------------------------------------------
(0, node_test_1.test)('encNegate: Enc(v) + Enc(-v) decrypts to 0 (mod n)', () => {
    const v = 7n;
    const ct = (0, paillier_1.encrypt)(publicKey, v, 2n);
    const neg = (0, paillier_1.encNegate)(publicKey, ct);
    const sum = (0, paillier_1.encAdd)(publicKey, ct, neg);
    // Enc(v) + Enc(-v) = Enc(v + n - v) = Enc(n) ≡ Enc(0) mod n
    const plain = (0, paillier_1.decrypt)(keyPair, sum);
    strict_1.default.equal(plain % publicKey.n, 0n);
});
// ---------------------------------------------------------------------------
// computeEncryptedScore — full formula
// ---------------------------------------------------------------------------
(0, node_test_1.test)('computeEncryptedScore with all-zero outcomes returns BASE_SCORE', () => {
    const enc0 = (0, paillier_1.encrypt)(publicKey, 0n, 2n);
    const encScore = (0, paillier_1.computeEncryptedScore)(publicKey, enc0, enc0, enc0);
    const plain = (0, paillier_1.decrypt)(keyPair, encScore);
    strict_1.default.equal(plain, paillier_1.BASE_SCORE);
});
(0, node_test_1.test)('computeEncryptedScore: 3 fulfilled, 0 late, 0 breached', () => {
    // score = 50 + 10*3 - 10*0 - 50*0 = 80
    const encF = (0, paillier_1.encrypt)(publicKey, 3n, 2n);
    const enc0 = (0, paillier_1.encrypt)(publicKey, 0n, 3n);
    const encScore = (0, paillier_1.computeEncryptedScore)(publicKey, encF, enc0, enc0);
    const plain = (0, paillier_1.decrypt)(keyPair, encScore);
    strict_1.default.equal(plain, paillier_1.BASE_SCORE + paillier_1.FULFILLED_WEIGHT * 3n);
});
(0, node_test_1.test)('computeEncryptedScore: 0 fulfilled, 1 late, 0 breached', () => {
    // score = 50 + 0 - 10*1 - 0 = 40
    const enc0 = (0, paillier_1.encrypt)(publicKey, 0n, 2n);
    const encL = (0, paillier_1.encrypt)(publicKey, 1n, 3n);
    const encScore = (0, paillier_1.computeEncryptedScore)(publicKey, enc0, encL, enc0);
    const plain = (0, paillier_1.decrypt)(keyPair, encScore);
    strict_1.default.equal(plain, paillier_1.BASE_SCORE - paillier_1.LATE_WEIGHT);
});
(0, node_test_1.test)('computeEncryptedScore: 0 fulfilled, 0 late, 1 breached', () => {
    // score = 50 + 0 - 0 - 50*1 = 0  (clamped at 0 in service layer)
    const enc0 = (0, paillier_1.encrypt)(publicKey, 0n, 2n);
    const encB = (0, paillier_1.encrypt)(publicKey, 1n, 3n);
    const encScore = (0, paillier_1.computeEncryptedScore)(publicKey, enc0, enc0, encB);
    const plain = (0, paillier_1.decrypt)(keyPair, encScore);
    strict_1.default.equal(plain, paillier_1.BASE_SCORE - paillier_1.BREACH_WEIGHT);
});
// ---------------------------------------------------------------------------
// EncryptedScore wire format round-trip
// ---------------------------------------------------------------------------
(0, node_test_1.test)('toEncryptedScore / fromEncryptedScore round-trip for small value', () => {
    const v = 0xabcdef01234567n;
    const es = (0, paillier_1.toEncryptedScore)(v, 3);
    strict_1.default.equal((0, paillier_1.fromEncryptedScore)(es), v);
    strict_1.default.equal(es.count, 3);
});
(0, node_test_1.test)('toEncryptedScore / fromEncryptedScore round-trip for 128-bit value', () => {
    const v = (1n << 127n) | 0xdeadbeefn;
    const es = (0, paillier_1.toEncryptedScore)(v, 7);
    strict_1.default.equal((0, paillier_1.fromEncryptedScore)(es), v);
});
// ---------------------------------------------------------------------------
// Compact public key
// ---------------------------------------------------------------------------
(0, node_test_1.test)('compactPublicKey returns COMPACT_N as modulus', () => {
    const pk = (0, paillier_1.compactPublicKey)();
    strict_1.default.equal(pk.n, paillier_1.COMPACT_N);
    strict_1.default.equal(pk.nSquared, paillier_1.COMPACT_N * paillier_1.COMPACT_N);
    strict_1.default.equal(pk.g, paillier_1.COMPACT_N + 1n);
});
