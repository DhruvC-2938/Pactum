# Pactum EVM Oracle (proof of concept)

Destination-chain half of the Cross-Chain Reputation Bridging Standard — see
[`../docs/cross-chain-trust-bridge.md`](../docs/cross-chain-trust-bridge.md) for the full
architecture, message format, and security model this implements. This package is a proof of
concept for issue #74, not a production deployment.

## What's here

```
evm/
├── contracts/
│   ├── PactumTrustOracle.sol          # the Oracle: receives, verifies, and caches trust scores
│   ├── interfaces/
│   │   ├── IPactumTrustOracle.sol     # public read interface consumers integrate against
│   │   └── IPactumMessageReceiver.sol # generic messaging-network callback shape
│   └── mocks/
│       └── MockMessagingEndpoint.sol  # stands in for a real LayerZero/CCIP verified endpoint
└── test/
    └── PactumTrustOracle.test.js      # exercises the full verification model
```

`MockMessagingEndpoint` is a mock **only** of Layer 1 (transport authenticity — the part a real
messaging network provides: proving a message really did come from a given source chain/contract).
`PactumTrustOracle` itself is not a mock; every Layer 2 (application-level) check described in the
design doc — version, registry id, batch size, nonce, staleness, per-address ledger sequence — is
real and covered by tests.

## Running it

```bash
cd evm
npm install
npm run compile
npm test
```

## Swapping in a real messaging provider

Nothing in `PactumTrustOracle.sol` is LayerZero- or Chainlink-specific. Moving from the mock to a
real provider means:

1. Deploy (or point at) the provider's real endpoint contract (LayerZero `Endpoint` / CCIP
   `Router`) and call `setMessagingEndpoint` with its address, so `onlyEndpoint` now only accepts
   calls from the genuine, DON/DVN-verified endpoint instead of the mock.
2. Register the real relayer's source chain id and Soroban registry contract id via
   `setTrustedRemote`.
3. Adapt the provider's callback (`ILayerZeroReceiver.lzReceive` / `CCIPReceiver._ccipReceive`) to
   invoke `receiveMessage(sourceChainId, sourceAddress, payload)` with the values the provider has
   already verified — most providers call your contract directly rather than requiring you to
   implement their receiver interface yourself, so in practice this is usually a thin adapter
   contract or a direct implementation of the provider's receiver interface that forwards into
   `PactumTrustOracle`.

`_applyBatch` and everything after does not change.

## What's intentionally out of scope here

- **The relayer.** This PoC only covers the destination-chain contract; producing and sending
  `TrustScoreBatch` payloads from Stellar events is relayer work (a natural extension of
  `backend/src/workers/`), not something an EVM PoC can demonstrate.
- **A real messaging network integration.** Wiring up an actual LayerZero or Chainlink CCIP
  deployment requires their SDKs, funded accounts, and provider-specific configuration — out of
  scope for a design PoC, and orthogonal to the application-level logic this PoC proves out.
- **Gas benchmarking against a specific chain.** The design doc's gas-minimization claims
  (batching, packed storage, opt-in events) are structural; validating exact gas numbers depends on
  the target chain's fee market and is better done once a real provider is chosen.
