//! Confirmation/oracle attestation logic

use crate::commitments::{Commitment, CommitmentStatus, DataKey};
use crate::errors::Error;
use crate::events;
use soroban_sdk::{panic_with_error, Address, Env};

/// Performs attestation on a commitment, resolving its status.
///
/// # Authorization
/// * Authorized caller: `caller` (via `require_auth`), which must be either the commitment's
///   `issuer` or `counterparty`.
/// * Why: Only the participating parties involved in the commitment are authorized to attest
///   to its outcome.
pub fn attest(
    env: &Env,
    caller: Address,
    id: u64,
    outcome: CommitmentStatus,
) {
    // 1. Require authorization from the caller.
    caller.require_auth();

    // 2. Reject Pending or Disputed as an outcome value.
    if outcome == CommitmentStatus::Pending || outcome == CommitmentStatus::Disputed {
        panic_with_error!(env, Error::InvalidOutcome);
    }

    // 3. Load commitment from persistent storage.
    let mut commitment: Commitment = env
        .storage()
        .persistent()
        .get(&DataKey::Commitment(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    // 4. Verify caller is either issuer or counterparty.
    if caller != commitment.issuer && caller != commitment.counterparty {
        panic_with_error!(env, Error::Unauthorized);
    }

    // 5. Verify commitment is currently Pending.
    if commitment.status != CommitmentStatus::Pending {
        panic_with_error!(env, Error::AlreadyResolved);
    }

    // 6. Update status and attested_at timestamp.
    let now = env.ledger().timestamp();
    commitment.status = outcome;
    commitment.attested_at = Some(now);

    // 7. Save updated commitment to storage.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &commitment);

    // 8. Emit commitment_attested event.
    events::commitment_attested(env, id, outcome);
}

/// Returns true if the commitment is still Pending and current timestamp is past due_at.
pub fn is_overdue(env: &Env, id: u64) -> bool {
    let commitment: Commitment = env
        .storage()
        .persistent()
        .get(&DataKey::Commitment(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    commitment.status == CommitmentStatus::Pending
        && env.ledger().timestamp() > commitment.due_at
}
