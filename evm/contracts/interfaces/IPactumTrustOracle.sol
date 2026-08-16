// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPactumTrustOracle
/// @notice Destination-chain read interface for a Pactum trust score bridged from Stellar/Soroban.
/// @dev See docs/cross-chain-trust-bridge.md for the full design this interface implements.
interface IPactumTrustOracle {
    /// @notice Cached, bridged snapshot of a Stellar address's Pactum trust score.
    /// @dev The wire-format entry (score + 3 counts + sourceLedgerSeq) packs into a single
    /// 32-byte slot; `updatedAt` is appended on-chain when applying an update and occupies a
    /// second slot. See PactumTrustOracle.sol.
    struct TrustScore {
        int64 score;
        uint32 fulfilledCount;
        uint32 lateCount;
        uint32 breachedCount;
        uint64 sourceLedgerSeq;
        uint64 updatedAt;
    }

    /// @notice Returns the latest bridged trust score for a Stellar address.
    /// @param stellarAddress Raw 32-byte Stellar account/contract id (StrKey payload).
    function getTrustScore(bytes32 stellarAddress) external view returns (TrustScore memory);

    /// @notice Returns true if the cached score for `stellarAddress` is older than `maxAge`
    /// seconds, or if no score has ever been recorded for it.
    function isStale(bytes32 stellarAddress, uint256 maxAge) external view returns (bool);

    /// @notice Emitted once per applied cross-chain batch.
    event TrustScoreBatchUpdated(bytes32 indexed registryId, uint64 batchNonce, uint256 entryCount);

    /// @notice Emitted per updated address, only when detailed events are enabled.
    event TrustScoreUpdated(bytes32 indexed stellarAddress, int64 score, uint64 sourceLedgerSeq);
}
