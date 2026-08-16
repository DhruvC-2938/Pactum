// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPactumMessageReceiver} from "../interfaces/IPactumMessageReceiver.sol";

/// @title MockMessagingEndpoint
/// @notice Stand-in for a real cross-chain messaging network's verified endpoint (a LayerZero
/// `Endpoint`/`ULN` or a Chainlink CCIP `Router`), used only to exercise
/// `PactumTrustOracle`'s Layer 2 (application-level) checks in tests without depending on a live
/// provider.
/// @dev A real endpoint would only invoke `receiveMessage` after independently verifying, via
/// DON/DVN attestations, that the message genuinely originated from `sourceAddress` on
/// `sourceChainId` — that is Layer 1 (transport authenticity), and it is why
/// `PactumTrustOracle.onlyEndpoint` matters: nothing except this trusted address may ever call
/// `receiveMessage`. This mock intentionally has *no* such verification: `deliver` forwards
/// whatever it is given, because Layer 1 verification is explicitly out of scope for this
/// contract and is what a production integration would replace it with (see
/// docs/cross-chain-trust-bridge.md §9).
contract MockMessagingEndpoint {
    /// @notice Forwards a message to `target` exactly as a verified endpoint would, after having
    /// already authenticated its origin off-chain (which this mock does not do).
    function deliver(
        address target,
        uint32 sourceChainId,
        bytes calldata sourceAddress,
        bytes calldata payload
    ) external {
        IPactumMessageReceiver(target).receiveMessage(sourceChainId, sourceAddress, payload);
    }
}
