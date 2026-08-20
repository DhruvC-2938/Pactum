import { PactumStateProof, VerificationResult } from '../schemas/stateProof';
import { computeLeafHash, computeHeaderHash } from './encoder';
import { MerkleTree } from './merkleTree';

export function normalizeHex32(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return `0x${clean.toLowerCase().padStart(64, '0')}`;
}

/**
 * Cryptographically verifies a zero-trust PactumStateProof against a trusted Stellar ledger header hash.
 *
 * @param proof The state proof payload
 * @param trustedLedgerHeaderHash The known Stellar ledger header hash to anchor and verify against
 */
export function verifyPactumStateProof(
  proof: PactumStateProof,
  trustedLedgerHeaderHash?: string
): VerificationResult {
  try {
    if (!proof || proof.version !== '1.0.0') {
      return { valid: false, error: `Unsupported proof version: ${proof?.version}` };
    }

    if (!trustedLedgerHeaderHash) {
      return {
        valid: false,
        error: 'Trusted ledger header hash anchor is required for zero-trust verification',
      };
    }

    // 1. Verify Leaf Hash
    const expectedLeaf = computeLeafHash(
      proof.contractId,
      proof.stellarAddress,
      proof.scoreData
    );
    const expectedLeafHex = normalizeHex32(expectedLeaf.toString('hex'));
    const proofLeafHex = normalizeHex32(proof.leafHash);

    if (expectedLeafHex !== proofLeafHex) {
      return {
        valid: false,
        error: `Leaf hash mismatch. Claimed ${proof.leafHash}, computed ${expectedLeafHex}`,
      };
    }

    // 2. Verify Merkle Proof against State Root Hash
    const expectedRoot = Buffer.from(proof.stateRootHash.replace(/^0x/, ''), 'hex');
    const isMerkleValid = MerkleTree.verify(expectedLeaf, proof.merkleProof, expectedRoot);
    const proofStateRootHex = normalizeHex32(proof.stateRootHash);

    if (!isMerkleValid) {
      return {
        valid: false,
        error: `Merkle root mismatch. Leaf does not resolve to stateRootHash ${proof.stateRootHash}`,
      };
    }

    // 3. Verify BucketList / StateRoot match in Header Proof
    const headerBucketListHex = normalizeHex32(proof.headerProof.bucketListHash);
    if (headerBucketListHex !== proofStateRootHex) {
      return {
        valid: false,
        error: 'Header proof bucketListHash does not match stateRootHash',
      };
    }

    // 4. Verify Ledger Header Hash
    const computedHeader = computeHeaderHash(proof.ledgerSeq, proof.headerProof);
    const computedHeaderHex = normalizeHex32(computedHeader.toString('hex'));
    const proofHeaderHex = normalizeHex32(proof.ledgerHeaderHash);

    if (computedHeaderHex !== proofHeaderHex) {
      return {
        valid: false,
        error: `Ledger header hash mismatch. Claimed ${proof.ledgerHeaderHash}, computed ${computedHeaderHex}`,
      };
    }

    // 5. Verify against trusted header hash anchor
    const normalizedTrusted = normalizeHex32(trustedLedgerHeaderHash);
    if (proofHeaderHex !== normalizedTrusted) {
      return {
        valid: false,
        error: `Header hash ${proof.ledgerHeaderHash} does not match trusted hash ${trustedLedgerHeaderHash}`,
      };
    }

    return {
      valid: true,
      score: proof.scoreData.score,
      ledgerSeq: proof.ledgerSeq,
      stellarAddress: proof.stellarAddress,
      contractId: proof.contractId,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Verification exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
