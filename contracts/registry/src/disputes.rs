//! Dispute handling and resolution logic (Phase 3)

use crate::commitments::{
    Commitment, CommitmentStatus, DataKey, DisputeVotes, DISPUTE_WINDOW_SECONDS,
};
use crate::errors::Error;
use crate::events;
use soroban_sdk::{panic_with_error, Address, Env};

/// Raises a dispute on an attested commitment within the dispute window.
///
/// # Authorization
/// * Authorized caller: `caller` (via `require_auth`), which must be either the commitment's
///   `issuer` or `counterparty`.
/// * Why: Only the participating parties to the commitment have standing to contest
///   an attested outcome and initiate a dispute.
pub fn dispute(env: &Env, caller: Address, id: u64) {
    // 0. Fail fast if the protocol has been paused (emergency halt).
    crate::pausable::require_not_paused(env);

    // 1. Enter the reentrancy guard before any external interaction (including
    //    the require_auth call below, which may invoke a custom account contract).
    crate::reentrancy::enter(env);

    // 2. Require authorization from the caller.
    caller.require_auth();

    // 3. Load commitment from persistent storage (with legacy record migration).
    let mut commitment: Commitment = crate::commitments::get_commitment_record(env, id)
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    // 4. Verify caller is either issuer or counterparty.
    if caller != commitment.issuer && caller != commitment.counterparty {
        panic_with_error!(env, Error::Unauthorized);
    }

    // 5. Verify commitment is currently Fulfilled, Late, or Breached (i.e. already attested).
    match commitment.status {
        CommitmentStatus::Fulfilled | CommitmentStatus::Late | CommitmentStatus::Breached => {}
        _ => panic_with_error!(env, Error::InvalidTransition),
    }

    // 6. Verify the dispute is raised within the dispute window.
    let attested_at = commitment
        .attested_at
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidTransition));
    let now = env.ledger().timestamp();
    let deadline = attested_at.saturating_add(DISPUTE_WINDOW_SECONDS);

    if now > deadline {
        panic_with_error!(env, Error::DisputeWindowExpired);
    }

    // 7. Store old status for reputation adjustment.
    let old_status = commitment.status;

    // 8. Transition status to Disputed.
    commitment.status = CommitmentStatus::Disputed;

    // 9. Save updated commitment to storage.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &commitment);
    env.storage().persistent().extend_ttl(
        &DataKey::Commitment(id),
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );

    // 10. Update reputation (decrement previous outcome).
    crate::reputation::update_reputation(env, commitment.issuer.clone(), old_status, false);

    // 11. Update trust history (decrement previous outcome).
    crate::trust_score::update_trust_history(env, commitment.issuer.clone(), old_status, false);

    // 12. Emit commitment_disputed event.
    events::commitment_disputed(env, id);

    // 13. Release the reentrancy guard.
    crate::reentrancy::exit(env);
}

/// Resolves a disputed commitment to a final outcome.
///
/// Two authorization paths exist:
///
/// * **Custom resolver (plugin delegation).** A commitment created with a
///   `resolver_address` outside the arbitrator committee is settled directly by
///   that resolver — one call, no voting. This preserves the per-commitment
///   delegation the plugin system provides.
/// * **Arbitrator committee (majority vote).** Naming an arbitrator as the
///   `resolver_address` routes the dispute through the committee instead: every
///   call records the calling arbitrator's vote under `DataKey::Votes(id)`, and
///   the dispute only finalizes once the votes for one outcome exceed half the
///   size of the arbitrator set. No single arbitrator can settle the dispute
///   alone, removing the single point of trust.
///
/// # Authorization
/// * Authorized caller: `caller` (via `require_auth`), which must either be the
///   commitment's designated custom `resolver_address`, or a member of the
///   arbitrator committee for a committee-routed commitment.
/// * Why: dispute resolution authority is delegated either to the resolver
///   chosen at creation time, or — for committee-routed commitments — to the
///   majority of the mutually trusted arbitrators.
///
/// # Panics
/// * `Error::NotArbitrator` if the caller is neither the designated custom
///   resolver nor a committee member eligible to vote on this dispute.
/// * `Error::AlreadyVoted` if a committee member votes twice on the same dispute.
pub fn resolve_dispute(env: &Env, caller: Address, id: u64, final_outcome: CommitmentStatus) {
    // 0. Enter the reentrancy guard before any external interaction (including
    //    the require_auth call below, which may invoke a custom account contract).
    crate::reentrancy::enter(env);

    // 1. Require authorization from the caller.
    caller.require_auth();

    // 2. Reject Pending or Disputed as final_outcome. Must be Fulfilled, Late, or Breached.
    match final_outcome {
        CommitmentStatus::Fulfilled | CommitmentStatus::Late | CommitmentStatus::Breached => {}
        _ => panic_with_error!(env, Error::InvalidOutcome),
    }

    // 3. Load commitment from persistent storage (with legacy record migration).
    let mut commitment: Commitment = crate::commitments::get_commitment_record(env, id)
        .unwrap_or_else(|| panic_with_error!(env, Error::CommitmentNotFound));

    // 4. Verify commitment is currently Disputed.
    if commitment.status != CommitmentStatus::Disputed {
        panic_with_error!(env, Error::InvalidTransition);
    }

    // 5. Resolve the caller's role. A commitment whose `resolver_address` is a
    //    custom resolver outside the arbitrator committee is settled directly by
    //    that resolver (plugin delegation). Naming an arbitrator as the resolver
    //    instead routes the dispute into committee majority voting, and no one
    //    outside the committee may act on such a dispute.
    let arbitrators = crate::commitments::arbitrators(env);
    let is_designated_resolver = caller == commitment.resolver_address;
    let committee_routed = arbitrators.contains(&commitment.resolver_address);

    if is_designated_resolver && !committee_routed {
        // 6a. Direct resolution by a custom resolver (plugin delegation).
        finalize_resolution(env, &mut commitment, id, final_outcome);
        crate::reentrancy::exit(env);
        return;
    }

    // A committee-routed dispute is only open to the committee itself.
    if !committee_routed || !arbitrators.contains(&caller) {
        panic_with_error!(env, Error::NotArbitrator);
    }

    // 6b. Committee majority vote. Load the running tally for this dispute,
    //     record the caller's vote, and finalize only once the votes for the
    //     outcome exceed half the committee size.
    let mut votes: DisputeVotes = env
        .storage()
        .persistent()
        .get(&DataKey::Votes(id))
        .unwrap_or_else(|| DisputeVotes::new(env));

    // An arbitrator may only vote once per dispute.
    if votes.voters.contains_key(caller.clone()) {
        panic_with_error!(env, Error::AlreadyVoted);
    }
    votes.record(&caller, final_outcome);

    // Persist the updated tally on every vote so the stored record always
    // reflects the full dispute history, then check for a majority.
    env.storage().persistent().set(&DataKey::Votes(id), &votes);
    env.storage().persistent().extend_ttl(
        &DataKey::Votes(id),
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );

    let majority = arbitrators.len() / 2; // votes must strictly exceed this
    let tally = votes.count(final_outcome);

    if tally > majority {
        // 7a. The threshold is met: resolve with the majority outcome.
        finalize_resolution(env, &mut commitment, id, final_outcome);
    } else {
        // 7b. Still short of a majority: report the vote for off-chain tracking.
        events::arbitrator_vote_cast(env, id, &caller, final_outcome, tally, majority + 1);
    }

    // 8. Release the reentrancy guard.
    crate::reentrancy::exit(env);
}

/// Applies a final outcome to a disputed commitment: transitions the status,
/// clears `attested_at` (preventing a re-dispute), and rolls the outcome into
/// reputation, the trust history, and the event log.
fn finalize_resolution(
    env: &Env,
    commitment: &mut Commitment,
    id: u64,
    final_outcome: CommitmentStatus,
) {
    // 1. Update status to final_outcome and clear attested_at to prevent re-dispute.
    commitment.status = final_outcome;
    commitment.attested_at = None;

    // 2. Save updated commitment to storage.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), commitment);
    env.storage().persistent().extend_ttl(
        &DataKey::Commitment(id),
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );

    // 3. Update reputation (increment with final outcome).
    crate::reputation::update_reputation(env, commitment.issuer.clone(), final_outcome, true);

    // 4. Update trust history (increment with final outcome).
    crate::trust_score::update_trust_history(env, commitment.issuer.clone(), final_outcome, true);

    // 5. Emit dispute_resolved event.
    events::dispute_resolved(env, id, final_outcome);
}
