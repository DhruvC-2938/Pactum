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
