// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPactumTrustOracle} from "./IPactumTrustOracle.sol";

/// @title IPactumZeroTrustOracle
/// @notice Interface for the Pactum Zero-Trust Cross-Chain Oracle with automated fault recovery,
/// optimistic challenge periods, bonded dispute resolution, and slashing.
interface IPactumZeroTrustOracle is IPactumTrustOracle {
    enum BatchStatus {
        None,
        Proposed,
        Challenged,
        Finalized,
        Reverted
    }

    struct BatchProposal {
        uint64 batchNonce;
        uint64 proposedAt;
        uint64 challengeDeadline;
        address relayer;
        bytes32 stateRoot;
        BatchStatus status;
        uint256 entryCount;
    }

    struct Challenge {
        address challenger;
        uint256 bond;
        uint64 challengedAt;
        bytes fraudProof;
        string reason;
        bool resolved;
    }

    struct RelayerStake {
        uint256 bondedAmount;
        uint256 lockedAmount;
        uint64 activeProposals;
    }

    // -------------------------------------------------------------------------
    // View Functions
    // -------------------------------------------------------------------------

    function getBatchProposal(uint64 batchNonce) external view returns (BatchProposal memory);

    function getBatchChallenge(uint64 batchNonce) external view returns (Challenge memory);

    function getRelayerStake(address relayer) external view returns (RelayerStake memory);

    function challengePeriodDuration() external view returns (uint256);

    function minRelayerBond() external view returns (uint256);

    function minChallengerBond() external view returns (uint256);

    // -------------------------------------------------------------------------
    // State Transitions & Challenge-Response
    // -------------------------------------------------------------------------

    function challengeBatch(
        uint64 batchNonce,
        bytes calldata fraudProof,
        string calldata reason
    ) external payable;

    function finalizeBatch(uint64 batchNonce) external;

    function resolveChallengeWithOverride(
        uint64 batchNonce,
        bytes calldata overrideProof,
        bytes calldata correctedPayload
    ) external;

    function adjudicateChallenge(uint64 batchNonce, bool fraudConfirmed) external;

    function depositRelayerBond() external payable;

    function withdrawRelayerBond(uint256 amount) external;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event BatchProposed(
        bytes32 indexed registryId,
        uint64 indexed batchNonce,
        address indexed relayer,
        uint256 entryCount,
        uint256 challengeDeadline
    );

    event BatchChallenged(
        uint64 indexed batchNonce,
        address indexed challenger,
        uint256 bond,
        string reason,
        bytes fraudProof
    );

    event BatchFinalized(
        bytes32 indexed registryId,
        uint64 indexed batchNonce,
        uint256 entryCount
    );

    event BatchReverted(
        bytes32 indexed registryId,
        uint64 indexed batchNonce,
        string reason
    );

    event ChallengeResolved(
        uint64 indexed batchNonce,
        bool relayerVindicated,
        address winner,
        uint256 reward
    );

    event RelayerSlashed(
        address indexed relayer,
        uint256 amount,
        address indexed recipient
    );

    event ChallengerSlashed(
        address indexed challenger,
        uint256 amount,
        address indexed recipient
    );

    event RelayerBondDeposited(address indexed relayer, uint256 amount);

    event RelayerBondWithdrawn(address indexed relayer, uint256 amount);

    event ChallengePeriodDurationUpdated(uint256 newPeriod);

    event BondRequirementsUpdated(uint256 minRelayerBond, uint256 minChallengerBond);
}
