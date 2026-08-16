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

/// Publishes an event when the protocol is paused (emergency halt) by the admin.
pub fn protocol_paused(env: &Env) {
    env.events().publish((symbol_short!("paused"),), ());
}

/// Publishes an event when the protocol is unpaused by the admin.
pub fn protocol_unpaused(env: &Env) {
    env.events().publish((symbol_short!("unpaused"),), ());
}

