# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Web3Auth social login for Web2 onboarding (#214): "Login with Google" (and
  other Web3Auth socials) provisions a non-custodial Stellar keypair beside
  Freighter/Albedo/Ledger, with in-app transaction signing for commitments and
  disputes. Set `VITE_WEB3AUTH_CLIENT_ID` to enable the modal.
- Optimistic rollup engine for high-frequency micro-commitment batching (#182):
  client-side deterministic state transitions + Merkle accumulator, Soroban
  `submit_batch_root` / `force_include` endpoints, and React UI for pending
  rollup vs on-chain finalized states.
- Formal verification pipeline for dispute-slashing economics (#192): pure
  `registry::economics` modules (slash cut, vault TVL, slash policy), unit
  tests in default Contract CI, and an optional Kani workflow
  (`workflow_dispatch` only) with bounded SMT proofs.
- Zero-trust state proof aggregation pipeline (#178): the relayer buffers
  commitment proofs until `MAX_BATCH_SIZE` or `BATCH_TTL`, emits one unified
  Merkle aggregation proof, and `PactumZeroTrustOracle.submitBatchedStateProof`
  unpacks the batch on-chain so EVM verification cost no longer scales linearly
  with event volume.
- Multi-arbitrator support with majority-vote dispute resolution (#11):
  `initialize()` now accepts a `Vec<Address>` arbitrator committee stored as
  `DataKey::ArbitratorSet`, `resolve_dispute()` records per-dispute votes under
  `DataKey::Votes(commitment_id)` and finalizes only when votes exceed half the
  committee size, and a new `get_arbitrators()` exposes the full set. Commitments
  that name a custom resolver outside the committee keep direct resolution.

## [Phase 4]

### Added

- Per-address reputation tracking (fulfilled/late/breached counts) as issuer

## [Phase 3]

### Added

- `dispute()` — raise a dispute within 7-day window after attestation
- `resolve_dispute()` — arbitrator-only final resolution with re-dispute prevention

## [Phase 2]

### Added

- `attest()` — issuer/counterparty outcome attestation
- `is_overdue()` — helper for checking commitment deadline

## [Phase 1]

### Added

- `create_commitment()`, `get_commitment()` core lifecycle
- Soroban persistent storage with TTL management
