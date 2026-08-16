//! M-of-N attestor voting and fallback timeout logic (Issue 62).
//!
//! High-value commitments can require consensus from multiple attestors
//! (e.g. 3 out of 5 must agree on the outcome). This module implements secure
//! vote tallying with an O(1) threshold check on every vote, and a fallback
//! timeout that resolves a commitment to a predefined fallback state if the
//! threshold is not reached by `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`.

use crate::commitments::{
    Commitment, CommitmentStatus, DataKey, VoteTally, ATTESTOR_VOTE_TIMEOUT_SECONDS,
    TTL_EXTEND_LEDGERS, TTL_THRESHOLD_LEDGERS,
};
use crate::errors::Error;
use crate::events;
use soroban_sdk::{panic_with_error, Address, Env};

/// The predefined fallback state entered when the vote threshold is not reached
/// within the timeout window, preventing locked funds/state.
const FALLBACK_STATUS: CommitmentStatus = CommitmentStatus::Breached;

/// Loads a commitment from persistent storage or panics with `CommitmentNotFound`.
fn load_commitment(env: &Env, id: u64) -> Commitment {
    env.storage()
        .persistent()
        .get(&DataKey::Commitment(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound))
}

/// Loads the running vote tally for a commitment, defaulting to zeroed counters.
fn load_tally(env: &Env, id: u64) -> VoteTally {
    env.storage()
        .persistent()
        .get(&DataKey::VoteTally(id))
        .unwrap_or(VoteTally {
            fulfilled: 0,
            late: 0,
            breached: 0,
        })
}

/// Persists a vote tally and extends its TTL.
fn save_tally(env: &Env, id: u64, tally: &VoteTally) {
    env.storage().persistent().set(&DataKey::VoteTally(id), tally);
    env.storage().persistent().extend_ttl(
        &DataKey::VoteTally(id),
        TTL_THRESHOLD_LEDGERS,
        TTL_EXTEND_LEDGERS,
    );
}

/// Returns true if `status` is a valid attestable outcome
/// (`Fulfilled`, `Late`, or `Breached`).
fn is_valid_outcome(status: CommitmentStatus) -> bool {
    matches!(
        status,
        CommitmentStatus::Fulfilled | CommitmentStatus::Late | CommitmentStatus::Breached
    )
}

/// Returns the absolute deadline (Unix seconds) by which the threshold must be met.
fn vote_deadline(commitment: &Commitment) -> u64 {
    commitment
        .due_at
        .saturating_add(ATTESTOR_VOTE_TIMEOUT_SECONDS)
}

/// Casts a single attestor vote on an M-of-N commitment, tallying it securely.
///
/// # Authorization
/// * Authorized caller: `caller` (via `require_auth`), which must be one of the
///   commitment's assigned `attestors`.
/// * Why: Only assigned attestors are permitted to vote on the commitment's outcome.
///
/// # Guarantees
/// * Each attestor can vote at most once (race-condition safe via `VoteRecord`).
/// * The threshold check is O(1): votes are stored in a running `VoteTally`
///   counter rather than by scanning prior votes, so the final (threshold-meeting)
///   vote never exhausts the gas limit.
///
/// # Panics
/// * `Error::CommitmentNotFound` if the commitment does not exist.
/// * `Error::AlreadyResolved` if the commitment is no longer `Pending`.
/// * `Error::NotAttestor` if `caller` is not an assigned attestor.
/// * `Error::InvalidOutcome` if `outcome` is `Pending` or `Disputed`.
/// * `Error::VotingClosed` if the vote is cast after `due_at + timeout`.
/// * `Error::AlreadyVoted` if the attestor has already cast a vote.
pub fn cast_attestor_vote(env: &Env, caller: Address, id: u64, outcome: CommitmentStatus) {
    // 1. Require authorization from the voting attestor.
    caller.require_auth();

    // 2. Load commitment from persistent storage.
    let mut commitment = load_commitment(env, id);

    // 3. Verify the commitment is still open for voting.
    if commitment.status != CommitmentStatus::Pending {
        panic_with_error!(env, Error::AlreadyResolved);
    }

    // 4. Verify the commitment actually requires attestor consensus.
    if commitment.attestors.is_empty() {
        panic_with_error!(env, Error::NotAttestor);
    }

    // 5. Verify the caller is an assigned attestor.
    if !commitment.attestors.contains(&caller) {
        panic_with_error!(env, Error::NotAttestor);
    }

    // 6. Reject Pending or Disputed as an outcome value.
    if !is_valid_outcome(outcome) {
        panic_with_error!(env, Error::InvalidOutcome);
    }

    // 7. Reject votes cast after the fallback deadline to prevent late votes.
    let now = env.ledger().timestamp();
    if now > vote_deadline(&commitment) {
        panic_with_error!(env, Error::VotingClosed);
    }

    // 8. Prevent double voting (race-condition safe: presence of VoteRecord
    //    indicates the attestor already voted).
    if env
        .storage()
        .persistent()
        .has(&DataKey::VoteRecord(id, caller.clone()))
    {
        panic_with_error!(env, Error::AlreadyVoted);
    }
    env.storage()
        .persistent()
        .set(&DataKey::VoteRecord(id, caller.clone()), &outcome);
    env.storage().persistent().extend_ttl(
        &DataKey::VoteRecord(id, caller.clone()),
        TTL_THRESHOLD_LEDGERS,
        TTL_EXTEND_LEDGERS,
    );

    // 9. O(1) tally update and threshold check.
    let mut tally = load_tally(env, id);
    tally.increment(outcome);
    let reached_threshold = tally.counter(outcome) >= commitment.threshold;

    if reached_threshold {
        // 10. Resolve the commitment to the agreed outcome.
        commitment.status = outcome;
        commitment.attested_at = Some(now);
        env.storage()
            .persistent()
            .set(&DataKey::Commitment(id), &commitment);
        env.storage().persistent().extend_ttl(
            &DataKey::Commitment(id),
            TTL_THRESHOLD_LEDGERS,
            TTL_EXTEND_LEDGERS,
        );
        save_tally(env, id, &tally);

        // 11. Update reputation (increment).
        crate::reputation::update_reputation(env, commitment.issuer.clone(), outcome, true);

        // 12. Emit commitment_resolved event.
        events::commitment_resolved(env, id, outcome);
    } else {
        // 13. Persist the tally and emit the vote event.
        save_tally(env, id, &tally);
        events::attestor_vote_cast(
            env,
            id,
            &caller,
            outcome,
            tally.counter(outcome),
            commitment.threshold,
        );
    }
}

/// Resolves an M-of-N commitment to the predefined fallback state if the vote
/// threshold was not reached by `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`.
///
/// This function is intentionally callable by anyone (no authorization) so that
/// any party or keeper can unblock a stalled commitment once attestors go
/// offline, preventing locked funds/state.
///
/// # Panics
/// * `Error::CommitmentNotFound` if the commitment does not exist.
/// * `Error::AlreadyResolved` if the commitment is no longer `Pending`.
/// * `Error::InvalidTransition` if the commitment has no assigned attestors.
/// * `Error::VotesNotMet` if called before the deadline has elapsed.
pub fn finalize_commitment(env: &Env, id: u64) {
    // 1. Load commitment from persistent storage.
    let mut commitment = load_commitment(env, id);

    // 2. Verify the commitment is still awaiting resolution.
    if commitment.status != CommitmentStatus::Pending {
        panic_with_error!(env, Error::AlreadyResolved);
    }

    // 3. Only M-of-N commitments are eligible for the fallback timeout.
    if commitment.attestors.is_empty() {
        panic_with_error!(env, Error::InvalidTransition);
    }

    // 4. Verify the fallback deadline has elapsed without the threshold being met.
    let now = env.ledger().timestamp();
    if now <= vote_deadline(&commitment) {
        panic_with_error!(env, Error::VotesNotMet);
    }

    // 5. Transition to the predefined fallback state.
    commitment.status = FALLBACK_STATUS;
    commitment.attested_at = Some(now);

    // 6. Save updated commitment to storage.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &commitment);
    env.storage().persistent().extend_ttl(
        &DataKey::Commitment(id),
        TTL_THRESHOLD_LEDGERS,
        TTL_EXTEND_LEDGERS,
    );

    // 7. Update reputation (increment) with the fallback outcome.
    crate::reputation::update_reputation(env, commitment.issuer.clone(), FALLBACK_STATUS, true);

    // 8. Emit commitment_fallback event.
    events::commitment_fallback(env, id, FALLBACK_STATUS);
}

/// Returns the running vote tally for a commitment.
///
/// # Panics
/// * `Error::CommitmentNotFound` if the commitment does not exist.
pub fn get_vote_tally(env: &Env, id: u64) -> VoteTally {
    load_commitment(env, id);
    load_tally(env, id)
}

/// Returns true if the fallback timeout has elapsed and the threshold was not met.
///
/// # Panics
/// * `Error::CommitmentNotFound` if the commitment does not exist.
pub fn can_finalize_commitment(env: &Env, id: u64) -> bool {
    let commitment = load_commitment(env, id);
    if commitment.status != CommitmentStatus::Pending || commitment.attestors.is_empty() {
        return false;
    }
    env.ledger().timestamp() > vote_deadline(&commitment)
}