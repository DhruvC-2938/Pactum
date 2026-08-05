# Registry Contract Reference

This document provides a comprehensive reference for all public functions, storage lifecycles, and configuration requirements of the Pactum Registry Contract.

## Contract Architecture
The registry is an immutable ledger for creating, tracking, and resolving on-chain commitments. The commitment lifecycle spans statuses from `Pending` up to `Fulfilled`, `Late`, `Breached`, and optionally `Disputed`.

## Storage Lifecycle & TTL
Soroban implements a Time-To-Live (TTL) model for data storage. The registry contract automatically extends the TTL of active data to prevent unexpected expiration.
- **`TTL_THRESHOLD_LEDGERS`**: `241920` (Approx 14 days)
- **`TTL_EXTEND_LEDGERS`**: `518400` (Approx 30 days)

### Persistent Storage
- **Commitments**: Preserved indefinitely as long as they are queried via `get_commitment` or updated via attest/dispute. Extended up to 30 days upon each access. 
- **Reputation**: Automatically extended to 30 days on each query or change. It must persist indefinitely as an immutable record of an issuer's reliability.

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
- **Authorization**: Requires authorization from `issuer`.
- **Returns**: `u64` (the unique identifier for the commitment).
- **Panics**: `Error::DueAtInPast` if `due_at` is in the past.

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
- **Panics**: `Error::Unauthorized` if the caller isn't participating, `Error::InvalidOutcome` if status is Pending/Disputed, `Error::AlreadyResolved` if no longer pending.

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
