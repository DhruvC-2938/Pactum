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
