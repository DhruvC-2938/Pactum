use crate::commitments::CommitmentStatus;
use soroban_sdk::{symbol_short, Address, Env};

/// Publishes an event when a new commitment is created.
pub fn commitment_created(
    env: &Env,
    id: u64,
    issuer: &Address,
    counterparty: &Address,
) {
    env.events().publish(
        (symbol_short!("created"), issuer.clone(), counterparty.clone()),
        id,
    );
}

/// Publishes an event when a commitment status is attested.
pub fn commitment_attested(
    env: &Env,
    id: u64,
    status: CommitmentStatus,
) {
    env.events().publish(
        (symbol_short!("attested"), id),
        status,
    );
}

/// Publishes an event when a commitment is disputed by a party.
pub fn commitment_disputed(
    env: &Env,
    id: u64,
) {
    env.events().publish(
        (symbol_short!("disputed"), id),
        (),
    );
}

/// Publishes an event when a dispute on a commitment is resolved by the arbitrator.
pub fn dispute_resolved(
    env: &Env,
    id: u64,
    final_outcome: CommitmentStatus,
) {
    env.events().publish(
        (symbol_short!("resolved"), id),
        final_outcome,
    );
}

/// Publishes an event when an attestor casts a vote on an M-of-N commitment.
pub fn attestor_vote_cast(
    env: &Env,
    id: u64,
    attestor: &Address,
    outcome: CommitmentStatus,
    tally: u32,
    threshold: u32,
) {
    env.events().publish(
        (symbol_short!("voted"), id, attestor.clone()),
        (outcome, tally, threshold),
    );
}

/// Publishes an event when an M-of-N commitment reaches its threshold and resolves.
pub fn commitment_resolved(
    env: &Env,
    id: u64,
    outcome: CommitmentStatus,
) {
    env.events().publish(
        (symbol_short!("vresolved"), id),
        outcome,
    );
}

/// Publishes an event when an M-of-N commitment falls back to a predefined
/// fallback state because the vote threshold was not reached in time.
pub fn commitment_fallback(
    env: &Env,
    id: u64,
    fallback_status: CommitmentStatus,
) {
    env.events().publish(
        (symbol_short!("fallback"), id),
        fallback_status,
    );
}

