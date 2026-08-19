pragma circom 2.1.6;

include "poseidon.circom";

/// One level of a Poseidon binary Merkle path.
///
/// `isRight` says which side the running hash sits on: 0 means `current` is the
/// left child and `sibling` the right, 1 means the opposite. The swap is done
/// with a single multiplication so the level costs one constraint on top of the
/// Poseidon permutation itself.
template MerklePathLevel() {
    signal input current;
    signal input sibling;
    signal input isRight;
    signal output out;

    // `isRight` is a private input, so it has to be pinned to {0, 1} explicitly.
    // Without this an out-of-range value would let a prover forge a path by
    // producing a `swap` term that is neither of the two legitimate orderings.
    isRight * (isRight - 1) === 0;

    signal diff <== sibling - current;
    signal swap <== isRight * diff;

    signal left <== current + swap;
    signal right <== sibling - swap;

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    out <== h.out;
}

/// Recomputes the Merkle root a leaf hashes up to, given its authentication path.
///
/// The root is an output rather than an input so the caller decides what to
/// compare it against — see `trust_threshold.circom`, which constrains it to
/// equal the published snapshot root.
template MerkleInclusionProof(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component level[depth];
    signal current[depth + 1];
    current[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        level[i] = MerklePathLevel();
        level[i].current <== current[i];
        level[i].sibling <== pathElements[i];
        level[i].isRight <== pathIndices[i];
        current[i + 1] <== level[i].out;
    }

    root <== current[depth];
}
