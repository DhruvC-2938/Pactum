// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPactumTrustOracle} from "./interfaces/IPactumTrustOracle.sol";
import {IPactumMessageReceiver} from "./interfaces/IPactumMessageReceiver.sol";

/// @title PactumTrustOracle
/// @notice Destination-chain proof of concept for the Cross-Chain Reputation Bridging Standard.
/// Caches Pactum trust scores bridged from the Soroban registry contract on Stellar. See
/// docs/cross-chain-trust-bridge.md for the full design and rationale for each check below.
/// @dev This contract implements Layer 2 (application-level integrity) of the verification model.
/// Layer 1 (transport authenticity) is delegated to `messagingEndpoint`, restricted via
/// `onlyEndpoint`, mirroring the standard LayerZero/CCIP "trusted peer" pattern. In this proof of
/// concept `messagingEndpoint` is a mock (see contracts/mocks/MockMessagingEndpoint.sol); in
/// production it would be a real provider's verified endpoint contract.
contract PactumTrustOracle is IPactumTrustOracle, IPactumMessageReceiver, Ownable {
    /// @notice Current schema version this contract knows how to decode.
    uint8 public constant SCHEMA_VERSION = 1;

    /// @notice Upper bound on entries per batch, so processing one message has predictable gas.
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @notice The messaging network's verified endpoint. Only this address may call
    /// `receiveMessage`.
    address public messagingEndpoint;

    /// @notice Allow-listed source chain id -> allow-listed source (Soroban) contract address,
    /// mirroring the LayerZero/CCIP "trusted remote" pattern: a message is only accepted if it
    /// both arrives via `messagingEndpoint` AND declares a (sourceChainId, sourceAddress) pair
    /// registered here.
    mapping(uint32 => bytes32) public trustedRemotes;

    /// @notice The single Soroban registry contract id this Oracle accepts batches from.
    bytes32 public registryId;

    /// @notice Maximum age, in seconds, a batch's `batchTimestamp` may have relative to
    /// `block.timestamp` at delivery before it is rejected as stale.
    uint256 public maxBatchAge;

    /// @notice If true, emit a `TrustScoreUpdated` event per entry in addition to the per-batch
    /// event. Off by default: most consumers only need current state via `getTrustScore`, and
    /// per-entry events are a meaningful share of a batch's gas cost.
    bool public emitDetailedEvents;

    /// @notice Last applied batch nonce for `registryId`. Batches must strictly increase this.
    uint64 public lastBatchNonce;

    mapping(bytes32 => TrustScore) private _scores;

    error NotMessagingEndpoint(address caller);
    error UntrustedRemote(uint32 sourceChainId, bytes32 sourceAddress);
    error UnsupportedVersion(uint8 version);
    error UnknownRegistry(bytes32 registryId);
    error BatchTooLarge(uint256 size, uint256 max);
    error NonceNotIncreasing(uint64 batchNonce, uint64 lastBatchNonce);
    error BatchTooStale(uint64 batchTimestamp, uint256 nowTimestamp, uint256 maxBatchAge);
    error LedgerSeqNotIncreasing(bytes32 stellarAddress, uint64 sourceLedgerSeq, uint64 lastLedgerSeq);

    event MessagingEndpointUpdated(address indexed endpoint);
    event TrustedRemoteUpdated(uint32 indexed sourceChainId, bytes32 sourceAddress);
    event RegistryIdUpdated(bytes32 indexed registryId);
    event MaxBatchAgeUpdated(uint256 maxBatchAge);
    event EmitDetailedEventsUpdated(bool enabled);

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

    constructor(
        address initialOwner,
        address initialMessagingEndpoint,
        bytes32 initialRegistryId,
        uint256 initialMaxBatchAge
    ) Ownable(initialOwner) {
        messagingEndpoint = initialMessagingEndpoint;
        registryId = initialRegistryId;
        maxBatchAge = initialMaxBatchAge;
        emit MessagingEndpointUpdated(initialMessagingEndpoint);
        emit RegistryIdUpdated(initialRegistryId);
        emit MaxBatchAgeUpdated(initialMaxBatchAge);
    }

    modifier onlyEndpoint() {
        if (msg.sender != messagingEndpoint) {
            revert NotMessagingEndpoint(msg.sender);
        }
        _;
    }

    // ---------------------------------------------------------------------
    // Owner configuration
    // ---------------------------------------------------------------------

    function setMessagingEndpoint(address endpoint) external onlyOwner {
        messagingEndpoint = endpoint;
        emit MessagingEndpointUpdated(endpoint);
    }

    function setTrustedRemote(uint32 sourceChainId, bytes32 sourceAddress) external onlyOwner {
        trustedRemotes[sourceChainId] = sourceAddress;
        emit TrustedRemoteUpdated(sourceChainId, sourceAddress);
    }

    function setRegistryId(bytes32 newRegistryId) external onlyOwner {
        registryId = newRegistryId;
        emit RegistryIdUpdated(newRegistryId);
    }

    function setMaxBatchAge(uint256 newMaxBatchAge) external onlyOwner {
        maxBatchAge = newMaxBatchAge;
        emit MaxBatchAgeUpdated(newMaxBatchAge);
    }

    function setEmitDetailedEvents(bool enabled) external onlyOwner {
        emitDetailedEvents = enabled;
        emit EmitDetailedEventsUpdated(enabled);
    }

    // ---------------------------------------------------------------------
    // IPactumMessageReceiver
    // ---------------------------------------------------------------------

    /// @inheritdoc IPactumMessageReceiver
    /// @dev Layer 1 (transport authenticity): restricted to `messagingEndpoint` and a registered
    /// (sourceChainId, sourceAddress) pair. Layer 2 (application-level integrity): every check in
    /// `_applyBatch`. See docs/cross-chain-trust-bridge.md §5.
    function receiveMessage(
        uint32 sourceChainId,
        bytes calldata sourceAddress,
        bytes calldata payload
    ) external onlyEndpoint {
        bytes32 remote = trustedRemotes[sourceChainId];
        if (remote == bytes32(0) || bytes32(sourceAddress) != remote) {
            revert UntrustedRemote(sourceChainId, bytes32(sourceAddress));
        }

        TrustScoreBatch memory batch = abi.decode(payload, (TrustScoreBatch));
        _applyBatch(batch);
    }

    // ---------------------------------------------------------------------
    // IPactumTrustOracle
    // ---------------------------------------------------------------------

    /// @inheritdoc IPactumTrustOracle
    function getTrustScore(bytes32 stellarAddress) external view returns (TrustScore memory) {
        return _scores[stellarAddress];
    }

    /// @inheritdoc IPactumTrustOracle
    function isStale(bytes32 stellarAddress, uint256 maxAge) external view returns (bool) {
        uint64 updatedAt = _scores[stellarAddress].updatedAt;
        if (updatedAt == 0) {
            return true;
        }
        return block.timestamp - uint256(updatedAt) > maxAge;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _applyBatch(TrustScoreBatch memory batch) internal {
        if (batch.version != SCHEMA_VERSION) {
            revert UnsupportedVersion(batch.version);
        }
        if (batch.registryId != registryId) {
            revert UnknownRegistry(batch.registryId);
        }
        if (batch.entries.length > MAX_BATCH_SIZE) {
            revert BatchTooLarge(batch.entries.length, MAX_BATCH_SIZE);
        }
        if (batch.batchNonce <= lastBatchNonce) {
            revert NonceNotIncreasing(batch.batchNonce, lastBatchNonce);
        }
        if (block.timestamp > uint256(batch.batchTimestamp) + maxBatchAge) {
            revert BatchTooStale(batch.batchTimestamp, block.timestamp, maxBatchAge);
        }

        lastBatchNonce = batch.batchNonce;

        uint256 length = batch.entries.length;
        for (uint256 i = 0; i < length; i++) {
            TrustScoreEntry memory entry = batch.entries[i];
            TrustScore storage existing = _scores[entry.stellarAddress];

            if (entry.sourceLedgerSeq <= existing.sourceLedgerSeq && existing.updatedAt != 0) {
                revert LedgerSeqNotIncreasing(
                    entry.stellarAddress,
                    entry.sourceLedgerSeq,
                    existing.sourceLedgerSeq
                );
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
}
