//! Confirmation/oracle attestation logic

use crate::commitments::{Commitment, CommitmentStatus, DataKey};
use crate::errors::Error;
use crate::events;
use soroban_sdk::{panic_with_error, Address, Env};

/// Attests the next pending milestone of a commitment.
///
/// For a single-milestone commitment this resolves the commitment outright,
/// which is the behaviour every non-milestone caller relies on.
///
/// # Authorization
/// * Authorized caller: `caller` (via `require_auth`), which must be either the commitment's
///   `issuer` or `counterparty`.
/// * Why: Only the participating parties involved in the commitment are authorized to attest
///   to its outcome.
pub fn attest(env: &Env, caller: Address, id: u64, outcome: CommitmentStatus) {
    attest_inner(env, caller, id, None, outcome);
}

/// Attests one specific milestone of a commitment.
///
/// Milestones are attested in order, so `milestone_index` must be the
/// commitment's next pending milestone.
///
/// # Authorization
/// * Same as [`attest`].
pub fn attest_milestone(
    env: &Env,
    caller: Address,
    id: u64,
    milestone_index: u32,
    outcome: CommitmentStatus,
) {
    attest_inner(env, caller, id, Some(milestone_index), outcome);
}

/// Returns the attested outcome of a milestone, or `None` while it is pending.
pub fn get_milestone(env: &Env, id: u64, milestone_index: u32) -> Option<CommitmentStatus> {
    let commitment: Commitment = crate::commitments::get_commitment_record(env, id)
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    if milestone_index >= commitment.milestone_count {
        panic_with_error!(env, Error::InvalidMilestoneIndex);
    }

    let key = DataKey::Milestone(id, milestone_index);
    let outcome = env.storage().persistent().get(&key);

    // Bump on access like get_commitment and get_reputation do, so an early
    // milestone cannot expire out from under a live commitment and start
    // reading back as pending.
    if outcome.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            crate::commitments::TTL_THRESHOLD_LEDGERS,
            crate::commitments::TTL_EXTEND_LEDGERS,
        );
    }

    outcome
}

/// Returns true if the commitment is still Pending and current timestamp is past due_at.
pub fn is_overdue(env: &Env, id: u64) -> bool {
    let commitment: Commitment = crate::commitments::get_commitment_record(env, id)
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    commitment.status == CommitmentStatus::Pending && env.ledger().timestamp() > commitment.due_at
}

/// A milestone attestation only moves the commitment out of `Pending` when it
/// breaches (which ends the commitment immediately) or when it is the final
/// milestone. Reputation and the trust history are therefore updated once per
/// commitment rather than once per milestone, which keeps the dispute flow's
/// single decrement correct.
fn attest_inner(
    env: &Env,
    caller: Address,
    id: u64,
    milestone_index: Option<u32>,
    outcome: CommitmentStatus,
) {
    // 0. Enter the reentrancy guard before any external interaction (including
    //    the require_auth call below, which may invoke a custom account contract).
    crate::reentrancy::enter(env);

    // 1. Require authorization from the caller.
    caller.require_auth();

    // 2. Reject Pending or Disputed as an outcome value.
    if outcome == CommitmentStatus::Pending || outcome == CommitmentStatus::Disputed {
        panic_with_error!(env, Error::InvalidOutcome);
    }

    // 3. Load commitment from persistent storage (with legacy record migration).
    let mut commitment: Commitment = crate::commitments::get_commitment_record(env, id)
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    // 4. Verify caller is either issuer or counterparty.
    if caller != commitment.issuer && caller != commitment.counterparty {
        panic_with_error!(env, Error::Unauthorized);
    }

    // 5. Verify commitment is currently Pending.
    if commitment.status != CommitmentStatus::Pending {
        panic_with_error!(env, Error::AlreadyResolved);
    }

    // 6. Resolve and validate the milestone being attested.
    let index = milestone_index.unwrap_or(commitment.milestones_attested);
    if index >= commitment.milestone_count {
        panic_with_error!(env, Error::InvalidMilestoneIndex);
    }
    if index < commitment.milestones_attested {
        panic_with_error!(env, Error::MilestoneAlreadyAttested);
    }
    if index > commitment.milestones_attested {
        panic_with_error!(env, Error::MilestoneOutOfOrder);
    }

    // 7. Record the milestone outcome and roll it into the commitment counters.
    commitment.milestones_attested = commitment.milestones_attested.saturating_add(1);
    if outcome == CommitmentStatus::Late {
        commitment.late_milestones = commitment.late_milestones.saturating_add(1);
    }

    env.storage()
        .persistent()
        .set(&DataKey::Milestone(id, index), &outcome);
    env.storage().persistent().extend_ttl(
        &DataKey::Milestone(id, index),
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );

    // 8. A breach ends the commitment on the spot; otherwise it only resolves
    //    once every milestone has been attested.
    let resolution = if outcome == CommitmentStatus::Breached {
        Some(CommitmentStatus::Breached)
    } else if commitment.milestones_attested == commitment.milestone_count {
        Some(if commitment.late_milestones > 0 {
            CommitmentStatus::Late
        } else {
            CommitmentStatus::Fulfilled
        })
    } else {
        None
    };

    if let Some(final_outcome) = resolution {
        commitment.status = final_outcome;
        commitment.attested_at = Some(env.ledger().timestamp());
    }

    // 9. Save updated commitment to storage.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &commitment);
    env.storage().persistent().extend_ttl(
        &DataKey::Commitment(id),
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );

    // 10. Emit the per-milestone event. Single-milestone commitments only emit
    //     commitment_attested, exactly as they did before milestones existed.
    if commitment.milestone_count > 1 {
        events::milestone_attested(env, id, index, outcome);
    }

    if let Some(final_outcome) = resolution {
        // 11. Update reputation (increment).
        crate::reputation::update_reputation(env, commitment.issuer.clone(), final_outcome, true);

        // 12. Update trust history (increment).
        crate::trust_score::update_trust_history(
            env,
            commitment.issuer.clone(),
            final_outcome,
            true,
        );

        // 13. Emit commitment_attested event.
        events::commitment_attested(env, id, final_outcome);
    }

    // 14. Release the reentrancy guard.
    crate::reentrancy::exit(env);
}
