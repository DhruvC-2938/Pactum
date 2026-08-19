# @pactum/zk-reputation

Zero-knowledge Trust Score threshold proofs for Pactum.

A user proves to a third party that their Trust Score exceeds a threshold — without
revealing the score, and without revealing which Stellar address is theirs. Proofs are
generated locally in the user's browser; nothing secret reaches the Pactum backend.

**Full design, security analysis and proving flow:
[`docs/zk-reputation-proofs.md`](../docs/zk-reputation-proofs.md).** Read the security
section before using this for anything real — the trusted setup shipped here is
deliberately insecure, and the proof does *not* establish control of the address.

## Layout

```
circuits/trust_threshold.circom   # the circuit: Merkle inclusion + range-checked score > threshold
circuits/merkle.circom            # Poseidon Merkle inclusion
src/score.ts                      # Trust Score from on-chain outcome counts
src/tree.ts                       # Poseidon Merkle snapshot + path derivation
src/strkey.ts                     # dependency-free Stellar address decoding
src/prove.ts                      # isomorphic proof generation (browser + node)
src/verify.ts                     # off-chain verification, signals included
scripts/build-circuit.mjs         # compile + Groth16 setup
scripts/publish-snapshot.mjs      # indexer side: counts.json -> snapshot.json
scripts/verify-proof.mjs          # verifier side, as a command
scripts/demo.mjs                  # the whole flow end to end
```

## Usage

```bash
npm install
npm test                 # score, strkey, tree, verifier semantics — no circom needed
npm run build:circuit    # needs `circom` on PATH; see the doc for how to build it
npm run test:circuit     # above/below threshold, boundary, invalid path, range checks
npm run demo
```

Circuit tests skip when `build/` is absent rather than failing, so `npm test` works on
a machine without `circom`. CI builds the circuit so they actually run.
