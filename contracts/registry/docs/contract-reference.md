# Registry Contract Reference

This document provides a comprehensive reference for all public functions, storage lifecycles, and configuration requirements of the Pactum Registry Contract.

## Contract Architecture
The registry is an immutable ledger for creating, tracking, and resolving on-chain commitments. The commitment lifecycle spans statuses from `Pending` up to `Fulfilled`, `Late`, `Breached`, and optionally `Disputed`.

## Storage Lifecycle & TTL
Soroban implements a Time-To-Live (TTL) model for data storage. The registry contract automatically extends the TTL of active data to prevent unexpected expiration.
- **`TTL_THRESHOLD_LEDGERS`**: `241920` (Approx 14 days)
- **`TTL_EXTEND_LEDGERS`**: `518400` (Approx 30 days)
- **`ATTESTOR_VOTE_TIMEOUT_SECONDS`**: `604800` (7 days). M-of-N attestor voting must reach its threshold by `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`, otherwise the commitment falls back to a predefined fallback state (`Breached`).

### Persistent Storage
- **Commitments**: Preserved indefinitely as long as they are queried via `get_commitment` or updated via attest/dispute/vote. Extended up to 30 days upon each access. 
- **Reputation**: Automatically extended to 30 days on each query or change. It must persist indefinitely as an immutable record of an issuer's reliability.
- **Vote Records**: A `VoteRecord(commitment_id, attestor)` entry per cast vote (prevents double voting). Extended up to 30 days upon each vote.
- **Vote Tallies**: A `VoteTally(commitment_id)` counter per commitment holding the per-outcome vote counts, enabling O(1) threshold checks.
- **Trust History**: One entry per address (~52 bytes) holding the bucketed outcome history used by `get_trust_score`. Extended to 30 days on each query or change, mirroring the reputation bump-on-access pattern.

### Instance Storage
- **NextId & Arbitrator**: Extended to 30 days every time a new commitment is created or the arbitrator is retrieved. 

## Public Functions

### `initialize`
Initializes the contract with a designated arbitrator address. Can only be called once.
- **Parameters**: 
  - `env: Env`
  - `arbitrator: Address`: The address of the mutually trusted arbitrator.
- **Authorization**: Requires authorization from `arbitrator`.
- **Panics**: `Error::AlreadyInitialized` if already initialized.

### `create_commitment`
Creates and registers a new ongoing commitment between an issuer and a counterparty.
- **Parameters**:
  - `env: Env`
  - `issuer: Address`: The address making the commitment.
  - `counterparty: Address`: The address to whom the commitment is owed.
  - `terms_hash: BytesN<32>`: Hash of the off-chain terms.
  - `due_at: u64`: Unix timestamp (seconds) when the commitment is due.
  - `attestors: Vec<Address>`: Dynamically sized list of attestors assigned to adjudicate via M-of-N voting. Pass an empty list for regular single-party commitments.
  - `threshold: u32`: Required number of attestor votes (M in M-of-N). Must be `0` when `attestors` is empty and between `1` and `attestors.len()` otherwise.
- **Authorization**: Requires authorization from `issuer`.
- **Returns**: `u64` (the unique identifier for the commitment).
- **Panics**: `Error::DueAtInPast` if `due_at` is in the past, `Error::ThresholdInvalid` for an invalid threshold, `Error::DuplicateAttestor` for duplicate attestor addresses.

### `get_commitment`
Retrieves an existing commitment by its unique ID.
- **Parameters**: 
  - `env: Env`
  - `id: u64`
- **Returns**: `Commitment` struct containing full state details.
- **Panics**: `Error::CommitmentNotFound` if the ID does not exist.

### `attest`
Attests to the lifecycle status of a commitment.
- **Parameters**:
  - `env: Env`
  - `caller: Address`: The participant attesting the outcome (must be issuer or counterparty).
  - `id: u64`
  - `outcome: CommitmentStatus`: Must be `Fulfilled`, `Late`, or `Breached`.
- **Authorization**: Requires authorization from `caller`.
- **Panics**: `Error::Unauthorized` if the caller isn't participating, `Error::InvalidOutcome` if status is Pending/Disputed, `Error::AlreadyResolved` if no longer pending, `Error::InvalidTransition` if the commitment is an M-of-N commitment (which must be resolved via `cast_attestor_vote`).

### `cast_attestor_vote`
Casts a single attestor vote on an M-of-N commitment, tallying it securely.
- **Parameters**:
  - `env: Env`
  - `caller: Address`: The attestor casting the vote (must be an assigned attestor).
  - `id: u64`
  - `outcome: CommitmentStatus`: Must be `Fulfilled`, `Late`, or `Breached`.
- **Authorization**: Requires authorization from `caller`.
- **Guarantees**:
  - Each attestor may vote at most once (race-condition safe via `VoteRecord`).
  - The threshold check is **O(1)** — votes are counted in a running `VoteTally` rather than by scanning prior votes, so the final (threshold-meeting) vote never exhausts the gas limit.
- **Panics**: `Error::NotAttestor` if the caller isn't assigned, `Error::AlreadyVoted` on a duplicate vote, `Error::VotingClosed` after `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`, `Error::InvalidOutcome` for Pending/Disputed, `Error::AlreadyResolved` if no longer pending.

### `finalize_commitment`
Resolves an M-of-N commitment to the predefined fallback state (`Breached`) if the vote threshold was not reached by `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`. Callable by anyone so a stalled commitment (e.g. offline attestors) can always be unblocked, preventing locked funds/state.
- **Parameters**:
  - `env: Env`
  - `id: u64`
- **Panics**: `Error::VotesNotMet` before the deadline, `Error::InvalidTransition` for commitments without attestors, `Error::AlreadyResolved` if already resolved.

### `get_vote_tally`
Retrieves the running per-outcome vote tally for an M-of-N commitment.
- **Parameters**:
  - `env: Env`
  - `id: u64`
- **Returns**: `VoteTally` struct (fulfilled, late, breached counts). Zeroed if no votes yet.
- **Panics**: `Error::CommitmentNotFound` if the ID does not exist.

### `can_finalize_commitment`
Checks whether an M-of-N commitment can be finalized to its fallback state (timeout elapsed and threshold unmet).
- **Parameters**:
  - `env: Env`
  - `id: u64`
- **Returns**: `bool`.

### `is_overdue`
Checks whether a commitment is overdue.
- **Parameters**:
  - `env: Env`
  - `id: u64`
- **Returns**: `bool` (True if the commitment is `Pending` and the ledger timestamp is greater than `due_at`).

### `dispute`
Raises a dispute on an attested commitment within the dispute window (7 days).
- **Parameters**:
  - `env: Env`
  - `caller: Address`: The participant raising the dispute.
  - `id: u64`
- **Authorization**: Requires authorization from `caller`.
- **Panics**: `Error::DisputeWindowExpired` if called after the 7-day dispute window, `Error::InvalidTransition` if the commitment is already disputed or not yet attested.

### `resolve_dispute`
Resolves a disputed commitment to a final outcome.
- **Parameters**:
  - `env: Env`
  - `arbitrator: Address`: The designated arbitrator resolving the dispute.
  - `id: u64`
  - `final_outcome: CommitmentStatus`: The final adjudicated outcome.
- **Authorization**: Requires authorization from the designated `arbitrator`.
- **Panics**: `Error::NotArbitrator` if the caller is not the initialized arbitrator.

### `get_reputation`
Retrieves the aggregate reputation for a given address.
- **Parameters**:
  - `env: Env`
  - `address: Address`: The address to query.
- **Returns**: `Reputation` struct (fulfilled, late, breached counts). Returns zeroed counts if the address has no history.

### `get_trust_score`
Retrieves the 0..=100 time-decayed trust score for a given address as an issuer.
- **Parameters**:
  - `env: Env`
  - `address: Address`: The address to query.
- **Returns**: `u32` trust score in the range 0..=100. An address with no history scores the neutral baseline of 50.
- **Decay model**: Outcomes are aggregated into buckets of 10,000 ledgers (≈13.9 hours). Each bucket of age is decayed by a stepwise integer shift with a half-life of 64 buckets (≈37 days); after 2048 buckets (32 steps, ≈3.2 years) an outcome's weight is zero. Score = `clamp(50 + 10·F − 10·L − 50·B, 0, 100)` over the decayed effective counts, so a recent breach tanks the score immediately while its impact mathematically degrades as the ledger advances.
- **Complexity**: O(1) — a single storage read plus constant integer math; no iteration over historical commitments. Updated on every `attest`, `dispute`, and `resolve_dispute`.

## TrustGate Cross-Contract Interface

Exposing `get_trust_score` (and the mutating `attest`/`resolve_dispute` functions) to external contracts opens the registry up to cross-contract composability, and with it, reentrancy risk: Soroban's authorization framework can invoke arbitrary contract code (a custom account's `__check_auth`) while resolving `require_auth`, giving an untrusted contract a window to call back into the registry before the original call has finished mutating state.

Two safeguards address this:

1. **A standard, typed interface (`contracts/registry/src/trust_gate.rs`)** — two `#[contractclient]`-generated clients that external contracts should depend on instead of the full `registry` crate:
   - `TrustGateReaderClient` — read-only, exposes only `get_trust_score`. Always safe to call.
   - `TrustGateWriterClient` — state-mutating, exposes `attest` and `resolve_dispute`. Kept strictly separate from the reader interface so integrators cannot reach for a mutating call while only intending to read a trust score.

   `RegistryContract` implements both underlying traits as plain (non-exported) Rust trait impls, so the compiler enforces that these published interfaces never drift out of sync with the contract's actual public API.

2. **A reentrancy guard (`contracts/registry/src/reentrancy.rs`)** — every state-mutating entry point (`initialize`, `create_commitment`, `attest`, `dispute`, `resolve_dispute`) calls a guard `enter()` before `require_auth` (and therefore before any possible callback into untrusted contract code), and `exit()` only after all state changes are committed. A nested call into any guarded function while another is already in progress fails immediately with `Error::ReentrantCall` instead of observing or corrupting half-updated state. This enforces the Checks-Effects-Interactions pattern contract-wide: the only "interaction" point (`require_auth`) is protected on both sides by the lock.

   The test suite includes a malicious mock, `AttackerGate` (`contracts/registry/src/attacker_gate.rs`), registered as a commitment's arbitrator. It implements `CustomAccountInterface` and attempts, from within `__check_auth`, to re-enter `resolve_dispute` for the same commitment before the legitimate call has applied its state changes. The attempt is rejected with `Error::ReentrantCall`, and the legitimate call completes exactly once with correct final state (see `test_reentrancy_attack_during_resolve_dispute_is_blocked` in `contracts/registry/src/test.rs`).
