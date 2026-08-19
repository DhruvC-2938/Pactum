pragma circom 2.1.6;

include "poseidon.circom";
include "bitify.circom";
include "comparators.circom";
include "merkle.circom";

/// Proves "the Trust Score of some address in the published snapshot is strictly
/// greater than `threshold`" without revealing which address, or what the score is.
///
/// The leaf commits to the Stellar public key as two 128-bit limbs rather than one
/// field element: an ed25519 key is 256 bits and the BN254 scalar field is 254 bits,
/// so a single-element encoding would have to reduce mod p and two distinct keys
/// could collide onto the same leaf.
///
/// # Signals
/// * Public: `root`, `threshold`, `contextId`, and the `aboveThreshold` output.
/// * Private: `addrHi`, `addrLo`, `score`, `pathElements`, `pathIndices`.
///
/// # Parameters
/// * `depth` - Merkle tree depth; fixes the snapshot capacity at 2^depth addresses.
/// * `scoreBits` - bit width both comparison operands are range-checked to.
template TrustThresholdProof(depth, scoreBits) {
    // --- Public inputs -----------------------------------------------------
    // Root of the reputation snapshot the verifier is willing to trust.
    signal input root;
    // The bar being cleared. Public because the verifier has to know what was proven.
    signal input threshold;
    // Verifier/session binding. Domain-separates a proof so one accepted by DAO A
    // cannot be replayed at DAO B, which would otherwise accept the same bytes.
    signal input contextId;

    // --- Private inputs ----------------------------------------------------
    // High and low 128 bits of the 32-byte ed25519 public key behind the G... address.
    signal input addrHi;
    signal input addrLo;
    // The exact Trust Score. Never leaves the prover's machine.
    signal input score;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // --- Public output -----------------------------------------------------
    signal output aboveThreshold;

    // 1. Rebuild the leaf the indexer published for this address.
    //    addrHi/addrLo are deliberately not range-checked: a prover who lies about
    //    them just gets a different leaf, which then fails the inclusion check below.
    component leafHash = Poseidon(3);
    leafHash.inputs[0] <== addrHi;
    leafHash.inputs[1] <== addrLo;
    leafHash.inputs[2] <== score;

    // 2. Walk the authentication path and pin the result to the published root.
    component merkle = MerkleInclusionProof(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }
    merkle.root === root;

    // 3. Range-check both comparison operands before comparing them.
    //    GreaterThan is only sound when its inputs fit in `scoreBits` bits: it works
    //    by checking the sign bit of `in[1] - in[0] + 2^scoreBits`, and an operand
    //    at or above 2^scoreBits makes that sum wrap around the field modulus, so a
    //    low score can be made to look like a high one. These two Num2Bits are what
    //    stop that, and they are load-bearing rather than defensive.
    component scoreRange = Num2Bits(scoreBits);
    scoreRange.in <== score;
    component thresholdRange = Num2Bits(scoreBits);
    thresholdRange.in <== threshold;

    // 4. Strict comparison, matching the issue's "Trust Score > 800" phrasing.
    component gt = GreaterThan(scoreBits);
    gt.in[0] <== score;
    gt.in[1] <== threshold;
    aboveThreshold <== gt.out;

    // Constraining the output to 1 — rather than leaving it for the verifier to
    // inspect — means a below-threshold witness has no satisfying assignment at all.
    // A circuit that merely *outputs* the boolean still produces a perfectly valid
    // proof when the answer is 0, and any verifier that forgets to read the public
    // signal accepts it.
    aboveThreshold === 1;

    // 5. Force `contextId` into the constraint system. A public input that no
    //    constraint touches is dropped during compilation, which would silently
    //    remove the replay binding. Squaring it is the cheapest way to keep it.
    signal contextIdSquared;
    contextIdSquared <== contextId * contextId;
}

// depth 16 => 65,536 addresses per snapshot; scoreBits 32 => ample headroom over
// the 0..1000 Trust Score range while staying well inside GreaterThan's 252-bit limit.
component main {public [root, threshold, contextId]} = TrustThresholdProof(16, 32);
