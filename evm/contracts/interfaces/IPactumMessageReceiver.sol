// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPactumMessageReceiver
/// @notice The minimal generic surface a cross-chain messaging network's verified endpoint calls
/// once it has authenticated a message's origin. Modeled after the shared shape of LayerZero's
/// `ILayerZeroReceiver.lzReceive` and Chainlink CCIP's `CCIPReceiver._ccipReceive`: an opaque
/// payload plus the (already-verified) source chain and source contract it came from.
/// @dev Swapping the mock endpoint in evm/contracts/mocks for a real LayerZero OApp or CCIP
/// CCIPReceiver means adapting that provider's callback to invoke `receiveMessage` with these
/// arguments — `PactumTrustOracle`'s application-level logic does not change.
interface IPactumMessageReceiver {
    /// @param sourceChainId Provider-specific identifier for the source chain (e.g. a LayerZero
    /// endpoint id or CCIP chain selector) that the messaging network has already verified the
    /// message actually originated from.
    /// @param sourceAddress The source-chain sender address/contract id the messaging network has
    /// already verified signed/sent this message (opaque bytes since the source is Soroban, not
    /// an EVM chain, and so has no native `address` representation).
    /// @param payload ABI-encoded `PactumTrustOracle.TrustScoreBatch`.
    function receiveMessage(
        uint32 sourceChainId,
        bytes calldata sourceAddress,
        bytes calldata payload
    ) external;
}
