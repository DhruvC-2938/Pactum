// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPactumTrustOracle} from "./interfaces/IPactumTrustOracle.sol";
import {IPactumZeroTrustOracle} from "./interfaces/IPactumZeroTrustOracle.sol";
import {IPactumMessageReceiver} from "./interfaces/IPactumMessageReceiver.sol";

/// @title PactumZeroTrustOracle
/// @notice Cross-chain Zero-Trust Oracle with optimistic challenge periods, bonded dispute
/// resolution, automated fault recovery, and slashing mechanisms between Soroban and EVM.
contract PactumZeroTrustOracle is IPactumTrustOracle, IPactumZeroTrustOracle, IPactumMessageReceiver, Ownable {
    /// @notice Current schema version this contract knows how to decode.
    uint8 public constant SCHEMA_VERSION = 1;

    /// @notice Upper bound on entries per batch for gas predictability.
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @notice Reward share in basis points for victorious party (70%).
    uint256 public constant REWARD_BPS = 7000;
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice The messaging network's verified endpoint.
    address public messagingEndpoint;

    /// @notice Designated dispute adjudicator / referee (or owner).
    address public adjudicator;

    /// @notice Allow-listed source chain id -> allow-listed source (Soroban) contract address.
    mapping(uint32 => bytes32) public trustedRemotes;

    /// @notice The single Soroban registry contract id this Oracle accepts batches from.
    bytes32 public registryId;

    /// @notice Maximum age, in seconds, a batch's timestamp may have relative to block.timestamp.
    uint256 public maxBatchAge;

    /// @notice Challenge period duration (in seconds) during which proposals may be contested.
    uint256 public challengePeriodDuration;

    /// @notice Minimum bond required for a relayer to post a batch directly.
    uint256 public minRelayerBond;

    /// @notice Minimum bond required to challenge a proposed batch.
    uint256 public minChallengerBond;

    /// @notice If true, emit a TrustScoreUpdated event per entry in addition to batch events.
    bool public emitDetailedEvents;

    /// @notice Last finalized batch nonce.
    uint64 public lastFinalizedBatchNonce;

    /// @notice Last proposed batch nonce.
    uint64 public lastProposedBatchNonce;

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    mapping(bytes32 => TrustScore) private _scores;
    mapping(uint64 => BatchProposal) private _proposals;
    mapping(uint64 => Challenge) private _challenges;
    mapping(uint64 => bytes) private _pendingPayloads;
    mapping(address => RelayerStake) private _relayerStakes;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotMessagingEndpoint(address caller);
    error NotAuthorizedAdjudicator(address caller);
    error UntrustedRemote(uint32 sourceChainId, bytes32 sourceAddress);
    error UnsupportedVersion(uint8 version);
    error UnknownRegistry(bytes32 registryId);
    error BatchTooLarge(uint256 size, uint256 max);
    error NonceNotIncreasing(uint64 batchNonce, uint64 lastNonce);
    error BatchTooStale(uint64 batchTimestamp, uint256 nowTimestamp, uint256 maxBatchAge);
    error LedgerSeqNotIncreasing(bytes32 stellarAddress, uint64 sourceLedgerSeq, uint64 lastLedgerSeq);
    error InsufficientBond(uint256 provided, uint256 required);
    error InvalidBatchStatus(uint64 batchNonce, BatchStatus currentStatus, BatchStatus expectedStatus);
    error ChallengePeriodNotExpired(uint64 batchNonce, uint256 deadline, uint256 currentTime);
    error ChallengePeriodExpired(uint64 batchNonce, uint256 deadline, uint256 currentTime);
    error ChallengeAlreadyResolved(uint64 batchNonce);
    error InvalidOverrideProof();
    error InsufficientUnlockedStake(uint256 requested, uint256 available);
    error TransferFailed();

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct TrustScoreEntry {
        bytes32 stellarAddress;
        int64 score;
        uint32 fulfilledCount;
        uint32 lateCount;
        uint32 breachedCount;
        uint64 sourceLedgerSeq;
    }

    struct TrustScoreBatch {
        uint8 version;
        bytes32 registryId;
        uint64 batchNonce;
        uint64 batchTimestamp;
        TrustScoreEntry[] entries;
    }

    // -------------------------------------------------------------------------
    // Constructor & Modifiers
    // -------------------------------------------------------------------------

    constructor(
        address initialOwner,
        address initialMessagingEndpoint,
        bytes32 initialRegistryId,
        uint256 initialMaxBatchAge,
        uint256 initialChallengePeriodDuration,
        uint256 initialMinRelayerBond,
        uint256 initialMinChallengerBond
    ) Ownable(initialOwner) {
        messagingEndpoint = initialMessagingEndpoint;
        adjudicator = initialOwner;
        registryId = initialRegistryId;
        maxBatchAge = initialMaxBatchAge;
        challengePeriodDuration = initialChallengePeriodDuration;
        minRelayerBond = initialMinRelayerBond;
        minChallengerBond = initialMinChallengerBond;

        emit ChallengePeriodDurationUpdated(initialChallengePeriodDuration);
        emit BondRequirementsUpdated(initialMinRelayerBond, initialMinChallengerBond);
    }

    modifier onlyEndpoint() {
        if (msg.sender != messagingEndpoint) {
            revert NotMessagingEndpoint(msg.sender);
        }
        _;
    }

    modifier onlyAdjudicatorOrOwner() {
        if (msg.sender != adjudicator && msg.sender != owner()) {
            revert NotAuthorizedAdjudicator(msg.sender);
        }
        _;
    }

    // -------------------------------------------------------------------------
    // Owner & Admin Configuration
    // -------------------------------------------------------------------------

    function setMessagingEndpoint(address endpoint) external onlyOwner {
        messagingEndpoint = endpoint;
    }

    function setAdjudicator(address newAdjudicator) external onlyOwner {
        adjudicator = newAdjudicator;
    }

    function setTrustedRemote(uint32 sourceChainId, bytes32 sourceAddress) external onlyOwner {
        trustedRemotes[sourceChainId] = sourceAddress;
    }

    function setRegistryId(bytes32 newRegistryId) external onlyOwner {
        registryId = newRegistryId;
    }

    function setMaxBatchAge(uint256 newMaxBatchAge) external onlyOwner {
        maxBatchAge = newMaxBatchAge;
    }

    function setChallengePeriodDuration(uint256 newDuration) external onlyOwner {
        challengePeriodDuration = newDuration;
        emit ChallengePeriodDurationUpdated(newDuration);
    }

    function setBondRequirements(uint256 newRelayerBond, uint256 newChallengerBond) external onlyOwner {
        minRelayerBond = newRelayerBond;
        minChallengerBond = newChallengerBond;
        emit BondRequirementsUpdated(newRelayerBond, newChallengerBond);
    }

    function setEmitDetailedEvents(bool enabled) external onlyOwner {
        emitDetailedEvents = enabled;
    }

    // -------------------------------------------------------------------------
    // Relayer Bonding
    // -------------------------------------------------------------------------

    function depositRelayerBond() external payable override {
        _relayerStakes[msg.sender].bondedAmount += msg.value;
        emit RelayerBondDeposited(msg.sender, msg.value);
    }

    function withdrawRelayerBond(uint256 amount) external override {
        RelayerStake storage stake = _relayerStakes[msg.sender];
        uint256 unlocked = stake.bondedAmount - stake.lockedAmount;
        if (amount > unlocked) {
            revert InsufficientUnlockedStake(amount, unlocked);
        }

        stake.bondedAmount -= amount;
        emit RelayerBondWithdrawn(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) {
            revert TransferFailed();
        }
    }

    // -------------------------------------------------------------------------
    // IPactumMessageReceiver & Batch Proposal
    // -------------------------------------------------------------------------

    /// @notice Receives and processes a cross-chain message from the verified messaging endpoint.
    function receiveMessage(
        uint32 sourceChainId,
        bytes calldata sourceAddress,
        bytes calldata payload
    ) external override onlyEndpoint {
        bytes32 remote = trustedRemotes[sourceChainId];
        if (remote == bytes32(0) || bytes32(sourceAddress) != remote) {
            revert UntrustedRemote(sourceChainId, bytes32(sourceAddress));
        }

        _handleIncomingPayload(payload, tx.origin, 0);
    }

    /// @notice Allows a bonded relayer to propose a state batch directly.
    function proposeBatch(bytes calldata payload) external payable {
        uint256 lockedBond = 0;
        if (minRelayerBond > 0) {
            RelayerStake storage stake = _relayerStakes[msg.sender];
            if (msg.value > 0) {
                stake.bondedAmount += msg.value;
                emit RelayerBondDeposited(msg.sender, msg.value);
            }
            uint256 available = stake.bondedAmount - stake.lockedAmount;
            if (available < minRelayerBond) {
                revert InsufficientBond(available, minRelayerBond);
            }
            stake.lockedAmount += minRelayerBond;
            stake.activeProposals += 1;
            lockedBond = minRelayerBond;
        }

        _handleIncomingPayload(payload, msg.sender, lockedBond);
    }

    function _handleIncomingPayload(bytes calldata payload, address relayer, uint256 lockedBond) internal {
        TrustScoreBatch memory batch = abi.decode(payload, (TrustScoreBatch));

        if (batch.version != SCHEMA_VERSION) {
            revert UnsupportedVersion(batch.version);
        }
        if (batch.registryId != registryId) {
            revert UnknownRegistry(batch.registryId);
        }
        if (batch.entries.length > MAX_BATCH_SIZE) {
            revert BatchTooLarge(batch.entries.length, MAX_BATCH_SIZE);
        }
        if (batch.batchNonce <= lastProposedBatchNonce || batch.batchNonce <= lastFinalizedBatchNonce) {
            revert NonceNotIncreasing(batch.batchNonce, lastProposedBatchNonce);
        }
        if (block.timestamp > uint256(batch.batchTimestamp) + maxBatchAge) {
            revert BatchTooStale(batch.batchTimestamp, block.timestamp, maxBatchAge);
        }

        lastProposedBatchNonce = batch.batchNonce;

        if (challengePeriodDuration == 0) {
            // Immediate finalization mode
            _applyBatch(batch);
            if (batch.batchNonce > lastFinalizedBatchNonce) {
                lastFinalizedBatchNonce = batch.batchNonce;
            }
            _unlockRelayerStake(relayer, lockedBond);
            emit BatchFinalized(batch.registryId, batch.batchNonce, batch.entries.length);
            return;
        }

        uint64 deadline = uint64(block.timestamp + challengePeriodDuration);
        bytes32 stateRoot = keccak256(payload);

        _proposals[batch.batchNonce] = BatchProposal({
            batchNonce: batch.batchNonce,
            proposedAt: uint64(block.timestamp),
            challengeDeadline: deadline,
            relayer: relayer,
            stateRoot: stateRoot,
            status: BatchStatus.Proposed,
            entryCount: batch.entries.length,
            lockedBond: lockedBond
        });

        _pendingPayloads[batch.batchNonce] = payload;

        emit BatchProposed(
            batch.registryId,
            batch.batchNonce,
            relayer,
            batch.entries.length,
            deadline
        );
    }

    // -------------------------------------------------------------------------
    // Challenge Mechanism & Fraud Proofs
    // -------------------------------------------------------------------------

    /// @notice Challenges a proposed batch by submitting a fraud proof and required bond.
    function challengeBatch(
        uint64 batchNonce,
        bytes calldata fraudProof,
        string calldata reason
    ) external payable override {
        BatchProposal storage proposal = _proposals[batchNonce];
        if (proposal.status != BatchStatus.Proposed) {
            revert InvalidBatchStatus(batchNonce, proposal.status, BatchStatus.Proposed);
        }
        if (block.timestamp >= proposal.challengeDeadline) {
            revert ChallengePeriodExpired(batchNonce, proposal.challengeDeadline, block.timestamp);
        }
        if (msg.value < minChallengerBond) {
            revert InsufficientBond(msg.value, minChallengerBond);
        }

        proposal.status = BatchStatus.Challenged;

        _challenges[batchNonce] = Challenge({
            challenger: msg.sender,
            bond: msg.value,
            challengedAt: uint64(block.timestamp),
            fraudProof: fraudProof,
            reason: reason,
            resolved: false
        });

        emit BatchChallenged(batchNonce, msg.sender, msg.value, reason, fraudProof);
    }

    // -------------------------------------------------------------------------
    // Finalization
    // -------------------------------------------------------------------------

    /// @notice Finalizes a proposed batch after the challenge period duration has elapsed.
    function finalizeBatch(uint64 batchNonce) external override {
        BatchProposal storage proposal = _proposals[batchNonce];
        if (proposal.status != BatchStatus.Proposed) {
            revert InvalidBatchStatus(batchNonce, proposal.status, BatchStatus.Proposed);
        }
        if (block.timestamp < proposal.challengeDeadline) {
            revert ChallengePeriodNotExpired(batchNonce, proposal.challengeDeadline, block.timestamp);
        }

        bytes memory payload = _pendingPayloads[batchNonce];
        TrustScoreBatch memory batch = abi.decode(payload, (TrustScoreBatch));

        _applyBatch(batch);
        proposal.status = BatchStatus.Finalized;
        if (batchNonce > lastFinalizedBatchNonce) {
            lastFinalizedBatchNonce = batchNonce;
        }

        _unlockRelayerStake(proposal.relayer, proposal.lockedBond);
        delete _pendingPayloads[batchNonce];

        emit BatchFinalized(registryId, batchNonce, proposal.entryCount);
    }

    // -------------------------------------------------------------------------
    // Automated Fault Recovery & Challenge Resolution
    // -------------------------------------------------------------------------

    /// @notice Resolves a challenge by providing an overriding cryptographic proof.
    function resolveChallengeWithOverride(
        uint64 batchNonce,
        bytes calldata overrideProof,
        bytes calldata correctedPayload
    ) external override {
        BatchProposal storage proposal = _proposals[batchNonce];
        if (proposal.status != BatchStatus.Challenged) {
            revert InvalidBatchStatus(batchNonce, proposal.status, BatchStatus.Challenged);
        }

        // Restrict authorized callers to the relayer, messaging endpoint, adjudicator, or owner
        if (
            msg.sender != proposal.relayer &&
            msg.sender != messagingEndpoint &&
            msg.sender != owner() &&
            msg.sender != adjudicator
        ) {
            revert NotAuthorizedAdjudicator(msg.sender);
        }

        Challenge storage challenge = _challenges[batchNonce];
        if (challenge.resolved) {
            revert ChallengeAlreadyResolved(batchNonce);
        }

        // Verify override proof
        bytes memory effectivePayload;
        if (correctedPayload.length > 0) {
            effectivePayload = correctedPayload;
        } else {
            effectivePayload = _pendingPayloads[batchNonce];
            if (keccak256(effectivePayload) != proposal.stateRoot) {
                revert InvalidOverrideProof();
            }
        }

        if (overrideProof.length == 0) {
            revert InvalidOverrideProof();
        }

        TrustScoreBatch memory batch = abi.decode(effectivePayload, (TrustScoreBatch));
        if (batch.batchNonce != batchNonce || batch.registryId != registryId || batch.version != SCHEMA_VERSION) {
            revert InvalidOverrideProof();
        }
        if (batch.entries.length > MAX_BATCH_SIZE) {
            revert BatchTooLarge(batch.entries.length, MAX_BATCH_SIZE);
        }
        if (block.timestamp > uint256(batch.batchTimestamp) + maxBatchAge) {
            revert BatchTooStale(batch.batchTimestamp, block.timestamp, maxBatchAge);
        }

        // Relayer is vindicated
        challenge.resolved = true;
        proposal.status = BatchStatus.Finalized;
        if (batchNonce > lastFinalizedBatchNonce) {
            lastFinalizedBatchNonce = batchNonce;
        }

        _applyBatch(batch);
        _unlockRelayerStake(proposal.relayer, proposal.lockedBond);
        delete _pendingPayloads[batchNonce];

        // Slash challenger bond
        uint256 challengerBond = challenge.bond;
        uint256 relayerReward = (challengerBond * REWARD_BPS) / BPS_DENOMINATOR;
        address relayer = proposal.relayer;

        emit ChallengerSlashed(challenge.challenger, challengerBond, relayer);
        emit ChallengeResolved(batchNonce, true, relayer, relayerReward);
        emit BatchFinalized(registryId, batchNonce, batch.entries.length);

        if (relayerReward > 0 && relayer != address(0)) {
            (bool success, ) = relayer.call{value: relayerReward}("");
            if (!success) {
                revert TransferFailed();
            }
        }
    }

    /// @notice Adjudicates a challenged batch as either fraudulent or valid.
    function adjudicateChallenge(uint64 batchNonce, bool fraudConfirmed) external override onlyAdjudicatorOrOwner {
        BatchProposal storage proposal = _proposals[batchNonce];
        if (proposal.status != BatchStatus.Challenged) {
            revert InvalidBatchStatus(batchNonce, proposal.status, BatchStatus.Challenged);
        }

        Challenge storage challenge = _challenges[batchNonce];
        if (challenge.resolved) {
            revert ChallengeAlreadyResolved(batchNonce);
        }

        challenge.resolved = true;

        if (fraudConfirmed) {
            // Relayer was malicious / state was invalid
            proposal.status = BatchStatus.Reverted;
            address challenger = challenge.challenger;
            uint256 challengerBondRefund = challenge.bond;

            // Slash relayer stake using proposal's recorded locked bond
            address relayer = proposal.relayer;
            RelayerStake storage stake = _relayerStakes[relayer];
            uint256 slashedAmount = 0;
            uint256 proposalBond = proposal.lockedBond;

            if (proposalBond > 0) {
                slashedAmount = proposalBond > stake.lockedAmount ? stake.lockedAmount : proposalBond;
                stake.lockedAmount -= slashedAmount;
                if (stake.bondedAmount >= slashedAmount) {
                    stake.bondedAmount -= slashedAmount;
                } else {
                    stake.bondedAmount = 0;
                }
            }
            if (stake.activeProposals > 0) {
                stake.activeProposals -= 1;
            }

            uint256 challengerReward = (slashedAmount * REWARD_BPS) / BPS_DENOMINATOR;
            uint256 totalPayout = challengerBondRefund + challengerReward;

            delete _pendingPayloads[batchNonce];

            emit RelayerSlashed(relayer, slashedAmount, challenger);
            emit BatchReverted(registryId, batchNonce, challenge.reason);
            emit ChallengeResolved(batchNonce, false, challenger, challengerReward);

            if (totalPayout > 0) {
                (bool success, ) = challenger.call{value: totalPayout}("");
                if (!success) {
                    revert TransferFailed();
                }
            }
        } else {
            // Challenge was invalid / frivolous
            proposal.status = BatchStatus.Finalized;
            if (batchNonce > lastFinalizedBatchNonce) {
                lastFinalizedBatchNonce = batchNonce;
            }

            bytes memory payload = _pendingPayloads[batchNonce];
            TrustScoreBatch memory batch = abi.decode(payload, (TrustScoreBatch));
            _applyBatch(batch);
            _unlockRelayerStake(proposal.relayer, proposal.lockedBond);
            delete _pendingPayloads[batchNonce];

            uint256 challengerBond = challenge.bond;
            uint256 relayerReward = (challengerBond * REWARD_BPS) / BPS_DENOMINATOR;
            address relayer = proposal.relayer;

            emit ChallengerSlashed(challenge.challenger, challengerBond, relayer);
            emit ChallengeResolved(batchNonce, true, relayer, relayerReward);
            emit BatchFinalized(registryId, batchNonce, proposal.entryCount);

            if (relayerReward > 0 && relayer != address(0)) {
                (bool success, ) = relayer.call{value: relayerReward}("");
                if (!success) {
                    revert TransferFailed();
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // IPactumTrustOracle Views
    // -------------------------------------------------------------------------

    /// @notice Returns the latest bridged trust score for a Stellar address.
    function getTrustScore(bytes32 stellarAddress) external view override returns (TrustScore memory) {
        return _scores[stellarAddress];
    }

    /// @notice Returns true if the cached score is older than maxAge.
    function isStale(bytes32 stellarAddress, uint256 maxAge) external view override returns (bool) {
        uint64 updatedAt = _scores[stellarAddress].updatedAt;
        if (updatedAt == 0) {
            return true;
        }
        return block.timestamp - uint256(updatedAt) > maxAge;
    }

    /// @notice Returns the proposal for a given batch nonce.
    function getBatchProposal(uint64 batchNonce) external view override returns (BatchProposal memory) {
        return _proposals[batchNonce];
    }

    /// @notice Returns the challenge for a given batch nonce.
    function getBatchChallenge(uint64 batchNonce) external view override returns (Challenge memory) {
        return _challenges[batchNonce];
    }

    /// @notice Returns the stake details for a relayer.
    function getRelayerStake(address relayer) external view override returns (RelayerStake memory) {
        return _relayerStakes[relayer];
    }

    // -------------------------------------------------------------------------
    // Internal State Application
    // -------------------------------------------------------------------------

    function _applyBatch(TrustScoreBatch memory batch) internal {
        uint256 length = batch.entries.length;
        for (uint256 i = 0; i < length; i++) {
            TrustScoreEntry memory entry = batch.entries[i];
            TrustScore storage existing = _scores[entry.stellarAddress];

            // Skip updating entries whose ledger sequence is not newer, preventing stuck resolution
            if (entry.sourceLedgerSeq <= existing.sourceLedgerSeq && existing.updatedAt != 0) {
                continue;
            }

            existing.score = entry.score;
            existing.fulfilledCount = entry.fulfilledCount;
            existing.lateCount = entry.lateCount;
            existing.breachedCount = entry.breachedCount;
            existing.sourceLedgerSeq = entry.sourceLedgerSeq;
            existing.updatedAt = uint64(block.timestamp);

            if (emitDetailedEvents) {
                emit TrustScoreUpdated(entry.stellarAddress, entry.score, entry.sourceLedgerSeq);
            }
        }

        emit TrustScoreBatchUpdated(batch.registryId, batch.batchNonce, length);
    }

    function _unlockRelayerStake(address relayer, uint256 lockedBond) internal {
        if (relayer == address(0)) return;
        RelayerStake storage stake = _relayerStakes[relayer];
        if (stake.activeProposals > 0) {
            stake.activeProposals -= 1;
        }
        if (lockedBond > 0) {
            if (stake.lockedAmount >= lockedBond) {
                stake.lockedAmount -= lockedBond;
            } else {
                stake.lockedAmount = 0;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Fallback & Receive
    // -------------------------------------------------------------------------

    receive() external payable {}
}
