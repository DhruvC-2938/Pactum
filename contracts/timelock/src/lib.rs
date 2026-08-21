#![no_std]
//! Pactum Timelock — the DAO-owned gate on every Pactum contract upgrade.
//!
//! # What this contract is, and what it is not
//!
//! The issue this implements asks for "a Timelock contract that owns the proxy". There
//! is no proxy: Soroban has no `delegatecall`, and a Soroban contract upgrades by
//! replacing its own executable in place, preserving its contract ID and all of its
//! storage. So what this contract owns is the *authority to trigger that in-place
//! upgrade* — it is installed as the registry's `upgrade_admin`, and the registry's
//! `upgrade` entrypoint requires this contract's authorization. The security property
//! is identical to the EVM arrangement (nobody can change the logic behind a stable
//! address without passing the delay) and the moving parts are far fewer.
//!
//! # The guarantee
//!
//! An upgrade requires:
//!
//! 1. `queue` by the admin, which pins the exact Wasm hash and target schema version;
//! 2. at least [`MIN_DELAY_SECONDS`] (7 days) of ledger time to pass;
//! 3. `execute` by the admin, before the grace period lapses.
//!
//! During (2) the proposal is public and fully specified, and the guardian — or the
//! admin — can cancel it. [`MIN_DELAY_SECONDS`] is a constant, not a stored parameter,
//! so no caller and no key compromise can shorten the window.
//!
//! # Threat model
//!
//! Defended:
//! * **Admin key compromise.** An attacker holding the admin key cannot upgrade
//!   anything for 7 days, cannot shorten that delay, and can be cut off entirely by
//!   the guardian cancelling the proposal and co-signing an admin rotation.
//! * **Bait-and-switch on the reviewed code.** The Wasm hash is stored in the proposal
//!   at queue time and read from nowhere else at execution, so the reviewed bytes are
//!   the executed bytes.
//! * **Replay of an executed upgrade.** State moves to `Executed` before the
//!   cross-contract call and the transition is one-way.
//! * **Stale authority.** Rotating the admin bumps an epoch that every queued proposal
//!   is pinned to, invalidating in-flight proposals rather than letting a departing
//!   (or ejected) admin's decisions execute under new management.
//! * **Zombie proposals.** A matured proposal expires after the grace period.
//!
//! Explicitly out of scope:
//! * **A malicious but validly-approved upgrade.** If the admin, the guardian and the
//!   7-day review all pass a hostile Wasm, this contract executes it. The defence is
//!   social — reproducible builds and public review — and this contract exists to buy
//!   the time for it, not to replace it.
//! * **A bricking upgrade.** New Wasm that omits an `upgrade` entrypoint permanently
//!   ends the target's upgradeability. Soroban applies the new executable only *after*
//!   the invoking call returns, so no same-transaction post-upgrade self-check is
//!   possible; this cannot be caught on-chain and is a review-time obligation.
//! * **Guardian griefing.** A malicious guardian can cancel every proposal, halting
//!   upgrades. That is the deliberate trade for giving it a veto; the guardian cannot
//!   queue or execute anything.
//! * **Governance vote integrity.** Whatever process elects the admin is upstream of
//!   this contract, which only records a `description_hash` pointing at it.

pub mod errors;
pub mod events;
pub mod types;

#[cfg(test)]
mod test;

use errors::Error;
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, Address, BytesN, Env, IntoVal, Symbol,
};
use types::{
    Proposal, ProposalAction, ProposalState, TimelockKey, GRACE_PERIOD_SECONDS, MAX_DELAY_SECONDS,
    MIN_DELAY_SECONDS, TTL_EXTEND_LEDGERS, TTL_THRESHOLD_LEDGERS,
};

/// The DAO-owned timelock that gates upgrades to the Pactum registry.
#[contract]
pub struct TimelockContract;

#[contractimpl]
impl TimelockContract {
    /// Initializes the timelock. Can only be called once.
    ///
    /// # Authorization
    /// * Authorized callers: both `admin` and `guardian` (via `require_auth`).
    /// * Why: neither address should be able to enrol the other into a role it did not
    ///   consent to, and the guardian's veto is only meaningful if the guardian is a
    ///   live key that has demonstrably signed at least once.
    ///
    /// # Arguments
    /// * `admin` - The address permitted to queue and execute proposals (the DAO).
    /// * `guardian` - The address permitted to cancel proposals and co-sign rotations.
    /// * `delay_seconds` - Execution delay. Must be within
    ///   [`MIN_DELAY_SECONDS`, `MAX_DELAY_SECONDS`].
    ///
    /// # Panics
    /// * Panics with `Error::AlreadyInitialized` if called more than once.
    /// * Panics with `Error::DelayTooShort` if `delay_seconds` is below 7 days.
    /// * Panics with `Error::DelayTooLong` if `delay_seconds` is above 90 days.
    pub fn initialize(env: Env, admin: Address, guardian: Address, delay_seconds: u64) {
        if env.storage().instance().has(&TimelockKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        validate_delay(&env, delay_seconds);

        admin.require_auth();
        guardian.require_auth();

        let storage = env.storage().instance();
        storage.set(&TimelockKey::Admin, &admin);
        storage.set(&TimelockKey::Guardian, &guardian);
        storage.set(&TimelockKey::Delay, &delay_seconds);
        storage.set(&TimelockKey::AdminEpoch, &0u32);
        storage.set(&TimelockKey::NextProposalId, &1u64);
        extend_instance_ttl(&env);

        events::initialized(&env, &admin, &guardian, delay_seconds);
    }

    /// Retrieves the current admin.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    pub fn get_admin(env: Env) -> Address {
        read_admin(&env)
    }

    /// Retrieves the current guardian.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    pub fn get_guardian(env: Env) -> Address {
        read_guardian(&env)
    }

    /// Retrieves the configured execution delay in seconds.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    pub fn get_delay(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&TimelockKey::Delay)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Retrieves the current admin epoch. Bumped on every admin rotation.
    pub fn get_admin_epoch(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&TimelockKey::AdminEpoch)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Retrieves the enforced minimum delay. Constant, and identical for every
    /// deployment of this executable.
    pub fn min_delay(_env: Env) -> u64 {
        MIN_DELAY_SECONDS
    }

    /// Retrieves a proposal by id.
    ///
    /// # Panics
    /// * Panics with `Error::ProposalNotFound` if no such proposal exists.
    pub fn get_proposal(env: Env, id: u64) -> Proposal {
        let proposal = read_proposal(&env, id);
        env.storage().persistent().extend_ttl(
            &TimelockKey::Proposal(id),
            TTL_THRESHOLD_LEDGERS,
            TTL_EXTEND_LEDGERS,
        );
        proposal
    }

    /// Returns true if the proposal exists, is still queued, and its `eta` has passed
    /// without its grace period lapsing.
    ///
    /// # Panics
    /// * Panics with `Error::ProposalNotFound` if no such proposal exists.
    pub fn is_executable(env: Env, id: u64) -> bool {
        let proposal = read_proposal(&env, id);
        let now = env.ledger().timestamp();
        proposal.state == ProposalState::Queued
            && proposal.admin_epoch == Self::get_admin_epoch(env)
            && now >= proposal.eta
            && now <= proposal.expires_at
    }

    /// Queues a governance action against `target`, starting the delay.
    ///
    /// # Authorization
    /// * Authorized caller: `proposer`, which must equal the stored admin (via `require_auth`).
    /// * Why: proposing is the act that puts a specific Wasm hash in front of the
    ///   public for review, and only the governance authority should be able to make
    ///   the protocol's review queue say something.
    ///
    /// # Arguments
    /// * `proposer` - Must be the current admin.
    /// * `target` - The contract the action will be applied to.
    /// * `action` - What to do. For `Upgrade`, the Wasm hash is pinned here and is
    ///   never re-read from anywhere else at execution time.
    /// * `description_hash` - Hash of the off-chain rationale, for reviewers to check
    ///   the proposal against. Not interpreted on-chain.
    ///
    /// # Returns
    /// * `u64` - The new proposal's id.
    ///
    /// # Panics
    /// * Panics with `Error::NotAdmin` if `proposer` is not the stored admin.
    /// * Panics with `Error::InvalidSchemaVersion` if an `Upgrade` action names schema
    ///   version 0, which no executable uses.
    /// * Panics with `Error::Overflow` if the id counter or an `eta` would overflow.
    pub fn queue(
        env: Env,
        proposer: Address,
        target: Address,
        action: ProposalAction,
        description_hash: BytesN<32>,
    ) -> u64 {
        proposer.require_auth();

        let admin = read_admin(&env);
        if proposer != admin {
            panic_with_error!(&env, Error::NotAdmin);
        }

        if let ProposalAction::Upgrade(_, schema_version) = &action {
            if *schema_version == 0 {
                panic_with_error!(&env, Error::InvalidSchemaVersion);
            }
        }

        let storage = env.storage().instance();
        let id: u64 = storage.get(&TimelockKey::NextProposalId).unwrap_or(1);
        let next_id = id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        storage.set(&TimelockKey::NextProposalId, &next_id);

        let delay: u64 = storage
            .get(&TimelockKey::Delay)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let admin_epoch: u32 = storage
            .get(&TimelockKey::AdminEpoch)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));

        let now = env.ledger().timestamp();
        let eta = now
            .checked_add(delay)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        let expires_at = eta
            .checked_add(GRACE_PERIOD_SECONDS)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

        let proposal = Proposal {
            id,
            target,
            action,
            proposer,
            admin_epoch,
            queued_at: now,
            eta,
            expires_at,
            state: ProposalState::Queued,
            description_hash,
        };

        write_proposal(&env, &proposal);
        extend_instance_ttl(&env);
        events::queued(&env, &proposal);

        id
    }

    /// Cancels a queued proposal.
    ///
    /// # Authorization
    /// * Authorized caller: `caller`, which must be the admin or the guardian (via `require_auth`).
    /// * Why: the guardian's only power is the veto, and it is the mechanism that makes
    ///   the 7-day window actionable rather than merely observable. The admin can also
    ///   cancel so it can withdraw its own proposals without waiting them out.
    ///
    /// # Panics
    /// * Panics with `Error::NotAdminOrGuardian` if `caller` holds neither role.
    /// * Panics with `Error::ProposalNotFound` if no such proposal exists.
    /// * Panics with `Error::ProposalNotQueued` if it already executed or was cancelled.
    pub fn cancel(env: Env, caller: Address, id: u64) {
        caller.require_auth();

        let admin = read_admin(&env);
        let guardian = read_guardian(&env);
        if caller != admin && caller != guardian {
            panic_with_error!(&env, Error::NotAdminOrGuardian);
        }

        let mut proposal = read_proposal(&env, id);
        if proposal.state != ProposalState::Queued {
            panic_with_error!(&env, Error::ProposalNotQueued);
        }

        proposal.state = ProposalState::Cancelled;
        write_proposal(&env, &proposal);

        events::cancelled(&env, id, &caller);
        events::state_changed(&env, id, ProposalState::Cancelled);
    }

    /// Executes a matured proposal against its target.
    ///
    /// # Authorization
    /// * Authorized caller: `caller`, which must equal the stored admin (via `require_auth`).
    /// * Why: execution is restricted rather than permissionless so that the DAO
    ///   retains the ability to simply not execute a proposal it has changed its mind
    ///   about, without racing a third party to the cancel.
    ///
    /// The proposal is marked `Executed` *before* the cross-contract call, so a target
    /// that re-enters this contract cannot execute the same proposal twice.
    ///
    /// # Panics
    /// * Panics with `Error::NotAdmin` if `caller` is not the stored admin.
    /// * Panics with `Error::ProposalNotFound` if no such proposal exists.
    /// * Panics with `Error::ProposalNotQueued` if it already executed or was cancelled.
    /// * Panics with `Error::ProposalStale` if the admin rotated after it was queued.
    /// * Panics with `Error::TimelockNotElapsed` if the `eta` has not been reached.
    /// * Panics with `Error::ProposalExpired` if the grace period has lapsed.
    pub fn execute(env: Env, caller: Address, id: u64) {
        caller.require_auth();

        let admin = read_admin(&env);
        if caller != admin {
            panic_with_error!(&env, Error::NotAdmin);
        }

        let mut proposal = read_proposal(&env, id);
        if proposal.state != ProposalState::Queued {
            panic_with_error!(&env, Error::ProposalNotQueued);
        }

        let current_epoch: u32 = env
            .storage()
            .instance()
            .get(&TimelockKey::AdminEpoch)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        if proposal.admin_epoch != current_epoch {
            panic_with_error!(&env, Error::ProposalStale);
        }

        let now = env.ledger().timestamp();
        if now < proposal.eta {
            panic_with_error!(&env, Error::TimelockNotElapsed);
        }
        if now > proposal.expires_at {
            panic_with_error!(&env, Error::ProposalExpired);
        }

        // Checks-effects-interactions: burn the proposal before calling out.
        proposal.state = ProposalState::Executed;
        write_proposal(&env, &proposal);
        events::state_changed(&env, id, ProposalState::Executed);

        dispatch(&env, &proposal);

        events::executed(&env, &proposal);
    }

    /// Rotates the admin, invalidating every queued proposal.
    ///
    /// # Authorization
    /// * Authorized callers: the current admin **and** the guardian (both via `require_auth`).
    /// * Why: two-of-two means a compromised admin key alone cannot hand governance to
    ///   an attacker, while a legitimate rotation — including an emergency rotation
    ///   away from a key believed compromised — is still immediate rather than
    ///   requiring the attacker to wait out a delay alongside the defenders.
    ///
    /// Bumping the epoch is what invalidates in-flight proposals. A departing admin's
    /// queued upgrades do not survive into the new administration by default; the new
    /// admin must re-queue anything it still wants, which restarts the full 7 days.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    /// * Panics with `Error::Overflow` if the epoch counter would overflow.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let old_admin = read_admin(&env);
        let guardian = read_guardian(&env);
        old_admin.require_auth();
        guardian.require_auth();

        let storage = env.storage().instance();
        let epoch: u32 = storage
            .get(&TimelockKey::AdminEpoch)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let next_epoch = epoch
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

        storage.set(&TimelockKey::Admin, &new_admin);
        storage.set(&TimelockKey::AdminEpoch, &next_epoch);
        extend_instance_ttl(&env);

        events::admin_transferred(&env, &old_admin, &new_admin, next_epoch);
    }

    /// Rotates the guardian.
    ///
    /// # Authorization
    /// * Authorized callers: the current guardian **and** the admin (both via `require_auth`).
    /// * Why: same two-of-two reasoning as `transfer_admin`. Neither role can
    ///   unilaterally remove the other's check on it.
    ///
    /// This does not bump the admin epoch: the guardian does not queue proposals, so
    /// rotating it does not call the provenance of anything in flight into question.
    pub fn transfer_guardian(env: Env, new_guardian: Address) {
        let admin = read_admin(&env);
        let old_guardian = read_guardian(&env);
        admin.require_auth();
        old_guardian.require_auth();

        env.storage()
            .instance()
            .set(&TimelockKey::Guardian, &new_guardian);
        extend_instance_ttl(&env);

        events::guardian_transferred(&env, &old_guardian, &new_guardian);
    }

    /// Changes the execution delay for proposals queued from now on.
    ///
    /// Already-queued proposals keep the `eta` they were given; the delay is pinned per
    /// proposal at queue time, so this cannot pull a pending upgrade forward.
    ///
    /// # Authorization
    /// * Authorized caller: the admin (via `require_auth`).
    /// * Why: the admin cannot use this to weaken the guarantee. `MIN_DELAY_SECONDS` is
    ///   a constant in this executable, so the only reachable changes are to a delay at
    ///   or above 7 days.
    ///
    /// # Panics
    /// * Panics with `Error::DelayTooShort` / `Error::DelayTooLong` if out of bounds.
    pub fn set_delay(env: Env, new_delay_seconds: u64) {
        let admin = read_admin(&env);
        admin.require_auth();
        validate_delay(&env, new_delay_seconds);

        let storage = env.storage().instance();
        let old: u64 = storage
            .get(&TimelockKey::Delay)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        storage.set(&TimelockKey::Delay, &new_delay_seconds);
        extend_instance_ttl(&env);

        events::delay_updated(&env, old, new_delay_seconds);
    }
}

/// Performs the target call for an executing proposal.
///
/// The Timelock authorizes as itself here: the target's `require_auth` on its stored
/// upgrade admin is satisfied because this contract is the direct caller.
fn dispatch(env: &Env, proposal: &Proposal) {
    match &proposal.action {
        ProposalAction::Upgrade(wasm_hash, schema_version) => {
            env.invoke_contract::<()>(
                &proposal.target,
                &symbol_short!("upgrade"),
                (wasm_hash.clone(), *schema_version).into_val(env),
            );
        }
        ProposalAction::SetUpgradeAdmin(new_admin) => {
            env.invoke_contract::<()>(
                &proposal.target,
                &Symbol::new(env, "set_upgrade_admin"),
                (new_admin.clone(),).into_val(env),
            );
        }
    }
}

fn validate_delay(env: &Env, delay_seconds: u64) {
    if delay_seconds < MIN_DELAY_SECONDS {
        panic_with_error!(env, Error::DelayTooShort);
    }
    if delay_seconds > MAX_DELAY_SECONDS {
        panic_with_error!(env, Error::DelayTooLong);
    }
}

fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&TimelockKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn read_guardian(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&TimelockKey::Guardian)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn read_proposal(env: &Env, id: u64) -> Proposal {
    env.storage()
        .persistent()
        .get(&TimelockKey::Proposal(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::ProposalNotFound))
}

fn write_proposal(env: &Env, proposal: &Proposal) {
    let key = TimelockKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
}
