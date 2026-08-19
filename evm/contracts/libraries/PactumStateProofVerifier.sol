// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PactumStateProofVerifier
/// @notice Standalone cryptographic verification library for Stellar / Soroban Pactum state proofs.
/// Cryptographically verifies that a user's trust score existed at a specific Stellar ledger height
/// against a known Stellar block header hash, without trusting any intermediary or relayer.
library PactumStateProofVerifier {
    struct ScoreData {
        uint32 score;
        uint32 fulfilledCount;
        uint32 lateCount;
        uint32 breachedCount;
        uint32 epoch;
        uint64 sourceLedgerSeq;
    }

    struct MerkleNode {
        bytes32 sibling;
        bool isRight;
    }

    struct HeaderProof {
        bytes32 previousLedgerHash;
        bytes32 txSetResultHash;
        bytes32 bucketListHash;
        uint32 ledgerVersion;
    }

    struct StateProof {
        string version;
        string networkPassphrase;
        uint64 ledgerSeq;
        bytes32 ledgerHeaderHash;
        bytes32 stateRootHash;
        bytes32 contractId;
        bytes32 stellarAddress;
        ScoreData scoreData;
        bytes32 leafHash;
        MerkleNode[] merkleProof;
        HeaderProof headerProof;
    }

    error UnsupportedVersion();
    error LeafHashMismatch(bytes32 expected, bytes32 actual);
    error MerkleRootMismatch(bytes32 expected, bytes32 actual);
    error BucketListMismatch(bytes32 stateRoot, bytes32 bucketList);
    error HeaderHashMismatch(bytes32 expected, bytes32 actual);
    error UntrustedHeaderHash(bytes32 claimed, bytes32 trusted);
    error LedgerSeqOverflow(uint64 ledgerSeq);

    /// @notice Computes the 32-byte SHA-256 leaf hash for a trust score contract data entry (92 bytes packed).
    function computeLeafHash(
        bytes32 contractId,
        bytes32 stellarAddress,
        ScoreData memory scoreData
    ) internal pure returns (bytes32) {
        return sha256(
            abi.encodePacked(
                contractId,
                stellarAddress,
                scoreData.score,
                scoreData.fulfilledCount,
                scoreData.lateCount,
                scoreData.breachedCount,
                scoreData.epoch,
                scoreData.sourceLedgerSeq
            )
        );
    }

    /// @notice Computes the Merkle Root from a leaf hash and audit path of sibling hashes.
    function computeMerkleRoot(
        bytes32 leaf,
        MerkleNode[] memory proof
    ) internal pure returns (bytes32) {
        bytes32 current = leaf;
        uint256 length = proof.length;

        for (uint256 i = 0; i < length; i++) {
            bytes32 sibling = proof[i].sibling;
            if (proof[i].isRight) {
                current = sha256(abi.encodePacked(current, sibling));
            } else {
                current = sha256(abi.encodePacked(sibling, current));
            }
        }

        return current;
    }

    /// @notice Computes the 32-byte SHA-256 header hash from ledger sequence and header proof fields (104 bytes packed).
    /// @dev Stellar ledger sequences fit in uint32. An overflow check is enforced if ledgerSeq exceeds type(uint32).max.
    function computeHeaderHash(
        uint64 ledgerSeq,
        HeaderProof memory headerProof
    ) internal pure returns (bytes32) {
        if (ledgerSeq > type(uint32).max) {
            revert LedgerSeqOverflow(ledgerSeq);
        }

        return sha256(
            abi.encodePacked(
                uint32(ledgerSeq),
                headerProof.previousLedgerHash,
                headerProof.txSetResultHash,
                headerProof.bucketListHash,
                headerProof.ledgerVersion
            )
        );
    }

    /// @notice Cryptographically verifies a zero-trust StateProof and reverts with a descriptive error if invalid.
    /// @param proof The state proof structure.
    /// @param trustedLedgerHeaderHash Non-zero trusted block hash to anchor verification against.
    /// @return score The verified trust score (0..100).
    function verifyProofOrRevert(
        StateProof memory proof,
        bytes32 trustedLedgerHeaderHash
    ) internal pure returns (uint32 score) {
        if (keccak256(bytes(proof.version)) != keccak256(bytes("1.0.0"))) {
            revert UnsupportedVersion();
        }

        bytes32 expectedLeaf = computeLeafHash(
            proof.contractId,
            proof.stellarAddress,
            proof.scoreData
        );
        if (expectedLeaf != proof.leafHash) {
            revert LeafHashMismatch(expectedLeaf, proof.leafHash);
        }

        bytes32 computedRoot = computeMerkleRoot(expectedLeaf, proof.merkleProof);
        if (computedRoot != proof.stateRootHash) {
            revert MerkleRootMismatch(computedRoot, proof.stateRootHash);
        }

        if (proof.stateRootHash != proof.headerProof.bucketListHash) {
            revert BucketListMismatch(proof.stateRootHash, proof.headerProof.bucketListHash);
        }

        bytes32 computedHeader = computeHeaderHash(proof.ledgerSeq, proof.headerProof);
        if (computedHeader != proof.ledgerHeaderHash) {
            revert HeaderHashMismatch(computedHeader, proof.ledgerHeaderHash);
        }

        if (trustedLedgerHeaderHash == bytes32(0) || proof.ledgerHeaderHash != trustedLedgerHeaderHash) {
            revert UntrustedHeaderHash(proof.ledgerHeaderHash, trustedLedgerHeaderHash);
        }

        return proof.scoreData.score;
    }

    /// @notice Cryptographically verifies a zero-trust StateProof returning boolean status.
    /// @param proof The state proof structure.
    /// @param trustedLedgerHeaderHash Non-zero trusted block hash to anchor verification against.
    /// @return isValid True if all cryptographic checks pass.
    /// @return score The verified trust score (0..100).
    function verifyProof(
        StateProof memory proof,
        bytes32 trustedLedgerHeaderHash
    ) internal pure returns (bool isValid, uint32 score) {
        if (keccak256(bytes(proof.version)) != keccak256(bytes("1.0.0"))) {
            return (false, 0);
        }

        bytes32 expectedLeaf = computeLeafHash(
            proof.contractId,
            proof.stellarAddress,
            proof.scoreData
        );
        if (expectedLeaf != proof.leafHash) {
            return (false, 0);
        }

        bytes32 computedRoot = computeMerkleRoot(expectedLeaf, proof.merkleProof);
        if (computedRoot != proof.stateRootHash) {
            return (false, 0);
        }

        if (proof.stateRootHash != proof.headerProof.bucketListHash) {
            return (false, 0);
        }

        if (proof.ledgerSeq > type(uint32).max) {
            return (false, 0);
        }

        bytes32 computedHeader = computeHeaderHash(proof.ledgerSeq, proof.headerProof);
        if (computedHeader != proof.ledgerHeaderHash) {
            return (false, 0);
        }

        if (trustedLedgerHeaderHash == bytes32(0) || proof.ledgerHeaderHash != trustedLedgerHeaderHash) {
            return (false, 0);
        }

        return (true, proof.scoreData.score);
    }
}
