import { PactumStateProof, VerificationResult } from '../schemas/stateProof';
import { computeLeafHash, computeHeaderHash } from './encoder';
import { MerkleTree } from './merkleTree';

export function verifyPactumStateProof(
  proof: PactumStateProof,
  trustedLedgerHeaderHash?: string
): VerificationResult {
  try {
    if (!proof || proof.version !== '1.0.0') {
      return { valid: false, error: `Unsupported proof version: ${proof?.version}` };
    }

    // 1. Verify Leaf Hash
    const expectedLeaf = computeLeafHash(
      proof.contractId,
      proof.stellarAddress,
      proof.scoreData
    );
    const expectedLeafHex = `0x${expectedLeaf.toString('hex')}`;

    if (expectedLeafHex.toLowerCase() !== proof.leafHash.toLowerCase()) {
      return {
        valid: false,
        error: `Leaf hash mismatch. Claimed ${proof.leafHash}, computed ${expectedLeafHex}`,
      };
    }

    // 2. Verify Merkle Proof against State Root Hash
    const expectedRoot = Buffer.from(proof.stateRootHash.replace(/^0x/, ''), 'hex');
    const isMerkleValid = MerkleTree.verify(expectedLeaf, proof.merkleProof, expectedRoot);

    if (!isMerkleValid) {
      return {
        valid: false,
        error: `Merkle root mismatch. Leaf does not resolve to stateRootHash ${proof.stateRootHash}`,
      };
    }

    // 3. Verify BucketList / StateRoot match in Header Proof
    if (
      proof.headerProof.bucketListHash.toLowerCase() !== proof.stateRootHash.toLowerCase()
    ) {
      return {
        valid: false,
        error: 'Header proof bucketListHash does not match stateRootHash',
      };
    }

    // 4. Verify Ledger Header Hash
    const computedHeader = computeHeaderHash(proof.ledgerSeq, proof.headerProof);
    const computedHeaderHex = `0x${computedHeader.toString('hex')}`;

    if (computedHeaderHex.toLowerCase() !== proof.ledgerHeaderHash.toLowerCase()) {
      return {
        valid: false,
        error: `Ledger header hash mismatch. Claimed ${proof.ledgerHeaderHash}, computed ${computedHeaderHex}`,
      };
    }

    // 5. If trusted header hash provided, check against it
    if (trustedLedgerHeaderHash) {
      const cleanTrusted = trustedLedgerHeaderHash.startsWith('0x')
        ? trustedLedgerHeaderHash.toLowerCase()
        : `0x${trustedLedgerHeaderHash}`.toLowerCase();

      if (proof.ledgerHeaderHash.toLowerCase() !== cleanTrusted) {
        return {
          valid: false,
          error: `Header hash ${proof.ledgerHeaderHash} does not match trusted hash ${trustedLedgerHeaderHash}`,
        };
      }
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
