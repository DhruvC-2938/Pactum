/**
 * `@pactum/zk-reputation` — zero-knowledge Trust Score threshold proofs.
 *
 * See docs/zk-reputation-proofs.md for the proof-generation flow, the security
 * properties this does and does not provide, and the trusted-setup caveat.
 */

export { trustScore, MAX_TRUST_SCORE, type ReputationCounts } from './score.ts';
export { decodeEd25519PublicKey, addressToLimbs } from './strkey.ts';
export {
  DEFAULT_TREE_DEPTH,
  EMPTY_LEAF,
  buildPoseidonHash,
  buildSnapshot,
  findLeafIndex,
  leafForEntry,
  merklePath,
  sortEntries,
  type MerklePath,
  type PoseidonHash,
  type ReputationEntry,
  type ReputationSnapshot,
} from './tree.ts';
export {
  generateTrustThresholdProof,
  toCircuitInput,
  type CircuitArtifact,
  type Groth16Proof,
  type TrustCircuitInput,
  type TrustProof,
  type TrustProofRequest,
} from './prove.ts';
export {
  parsePublicSignals,
  verifyTrustThresholdProof,
  PUBLIC_SIGNAL_ORDER,
  type PublicSignals,
  type VerificationKey,
  type VerificationResult,
  type VerifyRequest,
} from './verify.ts';
