//! Per-address compliance score aggregation (Phase 4)

use crate::commitments::CommitmentStatus;
use soroban_sdk::{contracttype, Address, Env};

/// Represents the aggregate reputation of an address as an issuer.
///
/// Note: Reputation only reflects an address's role as `issuer` (the party who
/// made the commitment). It does not count counterparty-side stats.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reputation {
    pub fulfilled_count: u32,
    pub late_count: u32,
    pub breached_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReputationKey {
    Reputation(Address),
}

/// Helper function to get the reputation for an address.
pub fn get_reputation(env: &Env, address: Address) -> Reputation {
    let rep = env.storage()
        .persistent()
        .get(&ReputationKey::Reputation(address.clone()))
        .unwrap_or(Reputation {
            fulfilled_count: 0,
            late_count: 0,
            breached_count: 0,
        });

    if env.storage().persistent().has(&ReputationKey::Reputation(address.clone())) {
        env.storage().persistent().extend_ttl(
            &ReputationKey::Reputation(address),
            crate::commitments::TTL_THRESHOLD_LEDGERS,
            crate::commitments::TTL_EXTEND_LEDGERS,
        );
    }
    
    rep
}

/// Helper function to update the reputation for an address.
/// `increment` is true when adding an outcome (e.g., in `attest` or `resolve_dispute`),
/// and false when removing an outcome (e.g., when a dispute is raised).
pub fn update_reputation(
    env: &Env,
    issuer: Address,
    outcome: CommitmentStatus,
    increment: bool,
) {
    let mut rep = get_reputation(env, issuer.clone());

    match outcome {
        CommitmentStatus::Fulfilled => {
            if increment {
                rep.fulfilled_count = rep.fulfilled_count.saturating_add(1);
            } else {
                rep.fulfilled_count = rep.fulfilled_count.saturating_sub(1);
            }
        }
        CommitmentStatus::Late => {
            if increment {
                rep.late_count = rep.late_count.saturating_add(1);
            } else {
                rep.late_count = rep.late_count.saturating_sub(1);
            }
        }
        CommitmentStatus::Breached => {
            if increment {
                rep.breached_count = rep.breached_count.saturating_add(1);
            } else {
                rep.breached_count = rep.breached_count.saturating_sub(1);
            }
        }
        _ => {}
    }

    env.storage()
        .persistent()
        .set(&ReputationKey::Reputation(issuer.clone()), &rep);
    
    env.storage().persistent().extend_ttl(
        &ReputationKey::Reputation(issuer),
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );
}

/// Helper function to compute a single weighted trust score for an address,
/// derived from its `Reputation` counts. Fulfilled commitments contribute
/// positively, late commitments are penalized lightly, and breached
/// commitments are penalized heavily. Read-only; safe to call from other
/// contracts (see `trust_gate`).
pub fn get_trust_score(env: &Env, address: Address) -> i64 {
    let rep = get_reputation(env, address);
    (rep.fulfilled_count as i64) * 2 - (rep.late_count as i64) - (rep.breached_count as i64) * 3
}
