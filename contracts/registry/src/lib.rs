#![no_std]
#![allow(clippy::too_many_arguments)]

pub mod attestation;
pub mod commitments;
pub mod disputes;
pub mod economics;
pub mod errors;
pub mod events;
pub mod fee_oracle;
mod pausable;
mod reentrancy;
pub mod reputation;
pub mod rollup;
pub mod staking;
pub mod trust_gate;
pub mod trust_score;
pub mod upgrade;
pub mod voting;

#[cfg(test)]
mod test_trust_score;

#[cfg(test)]
mod test_archival;

#[cfg(test)]
mod test;

#[cfg(test)]
mod test_staking;

#[cfg(test)]
mod test_upgrade;

#[cfg(test)]
mod attacker_gate;

#[cfg(test)]
mod demo;

#[cfg(test)]
mod test_voting;

pub use commitments::{Commitment, CommitmentStatus, DataKey, DISPUTE_WINDOW_SECONDS};
use errors::Error;
pub use rollup::{BatchRootRecord, ForcedInclusionRecord, MerkleNode};
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, BytesN, Env, Vec};
pub use staking::AttestorStake;
pub use upgrade::{SCHEMA_VERSION_V1, SCHEMA_VERSION_V2};
pub use voting::VoteTally;

#[contract]
pub struct RegistryContract;

#[contractimpl]
#[allow(clippy::too_many_arguments)]
impl RegistryContract {
    /// Initializes the contract with a committee of designated arbitrators and an admin.
    /// Can only be called once.
    ///
    /// Disputes on commitments that delegate to the committee are settled by a
    /// majority vote of this set rather than by a single point of trust.
    ///
    /// # Authorization
    /// * Authorized caller: every address in `arbitrators` and the `admin` (via `require_auth`).
    /// * Why: Requiring each designated arbitrator to authorize initialization
    ///   ensures that no address can be appointed to the committee without its
    ///   explicit consent. The admin must also authorize to ensure they consent
    ///   to their role.
    ///
    /// # Panics
    /// * Panics with `Error::AlreadyInitialized` if called more than once.
    /// * Panics with `Error::EmptyArbitratorSet` if `arbitrators` is empty.
    /// * Panics with `Error::AdminAlreadySet` if an admin is already set.
    pub fn initialize(env: Env, arbitrators: Vec<Address>, admin: Address) {
        // A legacy single-arbitrator deployment recorded a bare Address under
        // DataKey::Arbitrator; either key means the contract is already live.
        if env.storage().instance().has(&DataKey::ArbitratorSet)
            || env.storage().instance().has(&DataKey::Arbitrator)
        {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        if arbitrators.is_empty() {
            panic_with_error!(&env, Error::EmptyArbitratorSet);
        }

        reentrancy::enter(&env);

        // Require admin authorization
        admin.require_auth();

        // Set the admin first
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AdminAlreadySet);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Deduplicate first (so no address authorizes twice in the same
        // invocation) and require every distinct arbitrator to consent to their
        // appointment. Deduplicating also keeps the majority threshold computed
        // over distinct members.
        let mut deduped = Vec::new(&env);
        for a in arbitrators.iter() {
            if !deduped.contains(&a) {
                deduped.push_back(a.clone());
            }
        }
        for a in deduped.iter() {
            a.require_auth();
        }
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorSet, &deduped);

        env.storage().instance().extend_ttl(
            commitments::TTL_THRESHOLD_LEDGERS,
            commitments::TTL_EXTEND_LEDGERS,
        );

        reentrancy::exit(&env);
    }

    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        let arbitrators = commitments::arbitrators(&env);

        env.storage().instance().extend_ttl(
            commitments::TTL_THRESHOLD_LEDGERS,
            commitments::TTL_EXTEND_LEDGERS,
        );

        arbitrators
    }

    pub fn get_arbitrator(env: Env) -> Address {
        let arbitrators = commitments::arbitrators(&env);

        env.storage().instance().extend_ttl(
            commitments::TTL_THRESHOLD_LEDGERS,
            commitments::TTL_EXTEND_LEDGERS,
        );

        arbitrators
            .first()
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    pub fn create_commitment(
        env: Env,
        issuer: Address,
        counterparty: Address,
        terms_hash: BytesN<32>,
        due_at: u64,
        resolver_address: Address,
        oracle: Option<Address>,
        schema_id: Option<u32>,
        attestors: Vec<Address>,
        vote_threshold: u32,
    ) -> u64 {
        pausable::require_not_paused(&env);

        commitments::create(
            &env,
            issuer,
            counterparty,
            terms_hash,
            due_at,
            resolver_address,
            1,
            oracle,
            schema_id,
            attestors,
            vote_threshold,
        )
    }

    pub fn create_milestone_commitment(
        env: Env,
        issuer: Address,
        counterparty: Address,
        terms_hash: BytesN<32>,
        due_at: u64,
        resolver_address: Address,
        milestone_count: u32,
        oracle: Option<Address>,
        schema_id: Option<u32>,
        attestors: Vec<Address>,
        vote_threshold: u32,
    ) -> u64 {
        pausable::require_not_paused(&env);

        commitments::create(
            &env,
            issuer,
            counterparty,
            terms_hash,
            due_at,
            resolver_address,
            milestone_count,
            oracle,
            schema_id,
            attestors,
            vote_threshold,
        )
    }

    pub fn get_commitment(env: Env, id: u64) -> Commitment {
        let commitment = commitments::get_commitment_record(&env, id)
            .unwrap_or_else(|| panic_with_error!(&env, Error::CommitmentNotFound));

        env.storage().persistent().extend_ttl(
            &DataKey::Commitment(id),
            commitments::TTL_THRESHOLD_LEDGERS,
            commitments::TTL_EXTEND_LEDGERS,
        );

        commitment
    }

    pub fn migrate_commitment(env: Env, id: u64) -> Commitment {
        Self::get_commitment(env, id)
    }

    pub fn attest(env: Env, caller: Address, id: u64, outcome: CommitmentStatus) {
        pausable::require_not_paused(&env);
        attestation::attest(&env, caller, id, outcome);
    }

    pub fn attest_milestone(
        env: Env,
        caller: Address,
        id: u64,
        milestone_index: u32,
        outcome: CommitmentStatus,
    ) {
        pausable::require_not_paused(&env);
        attestation::attest_milestone(&env, caller, id, milestone_index, outcome);
    }

    pub fn get_milestone(env: Env, id: u64, milestone_index: u32) -> Option<CommitmentStatus> {
        attestation::get_milestone(&env, id, milestone_index)
    }

    pub fn is_overdue(env: Env, id: u64) -> bool {
        attestation::is_overdue(&env, id)
    }

    pub fn dispute(env: Env, caller: Address, id: u64) {
        pausable::require_not_paused(&env);
        disputes::dispute(&env, caller, id);
    }

    pub fn resolve_dispute(env: Env, caller: Address, id: u64, final_outcome: CommitmentStatus) {
        pausable::require_not_paused(&env);
        disputes::resolve_dispute(&env, caller, id, final_outcome);
    }

    pub fn cast_dispute_vote(env: Env, attestor: Address, id: u64, outcome: CommitmentStatus) {
        voting::cast_dispute_vote(&env, attestor, id, outcome);
    }

    pub fn check_dispute_timeout(env: Env, id: u64) {
        voting::check_dispute_timeout(&env, id);
    }

    pub fn get_reputation(env: Env, address: Address) -> reputation::Reputation {
        reputation::get_reputation(&env, address)
    }

    pub fn is_paused(env: Env) -> bool {
        pausable::is_paused(&env)
    }

    /// Pauses the protocol, halting every state-mutating entry point with
    /// `Error::ProtocolPaused` while leaving reads fully operational.
    ///
    /// This is the emergency kill-switch used in the event of a zero-day
    /// exploit. Admin lifecycle operations (`pause`, `unpause`, `upgrade`)
    /// are deliberately exempt so the admin can end the halt or deploy an
    /// emergency patch while the protocol is paused.
    ///
    /// # Authorization
    /// * Authorized caller: `admin` (via `require_auth`), the contract admin.
    /// * Why: Only the designated admin is authorized to trigger the emergency halt.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    /// * Panics with `Error::NotAdmin` if `admin` is not the contract admin.
    pub fn pause(env: Env, admin: Address) {
        reentrancy::enter(&env);

        admin.require_auth();
        commitments::require_admin(&env, &admin);

        pausable::set_paused(&env, true);
        events::protocol_paused(&env);

        reentrancy::exit(&env);
    }

    /// Unpauses the protocol, restoring its state-mutating entry points.
    ///
    /// # Authorization
    /// * Authorized caller: `admin` (via `require_auth`), the contract admin.
    /// * Why: Only the designated admin is authorized to end the halt.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    /// * Panics with `Error::NotAdmin` if `admin` is not the contract admin.
    pub fn unpause(env: Env, admin: Address) {
        reentrancy::enter(&env);

        admin.require_auth();
        commitments::require_admin(&env, &admin);

        pausable::set_paused(&env, false);
        events::protocol_unpaused(&env);

        reentrancy::exit(&env);
    }

    pub fn schema_version(env: Env) -> u32 {
        upgrade::schema_version(&env)
    }

    pub fn get_upgrade_admin(env: Env) -> Option<Address> {
        upgrade::upgrade_admin(&env)
    }

    /// Installs the initial upgrade admin — in production, the Timelock contract.
    ///
    /// # Authorization
    /// * Authorized caller: the contract admin (via `require_auth`).
    /// * Why: the contract admin is the authority responsible for managing upgrade
    ///   permissions. The path closes permanently once used; later changes go through
    ///   `set_upgrade_admin`, which only the admin can call.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    /// * Panics with `Error::UpgradeAdminAlreadySet` if an upgrade admin is installed.
    pub fn init_upgrade_admin(env: Env, admin: Address) {
        upgrade::init_upgrade_admin(&env, admin);
    }

    /// Transfers upgrade authority to a different address.
    ///
    /// # Authorization
    /// * Authorized caller: the contract admin (via `require_auth`).
    /// * Why: rotating the owner of every future upgrade is as consequential as an
    ///   upgrade, so it is restricted to the contract admin.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    /// * Panics with `Error::NotAdmin` if the caller is not the contract admin.
    /// * Panics with `Error::UpgradeAdminNotSet` if no upgrade admin is installed.
    pub fn set_upgrade_admin(env: Env, caller: Address, new_admin: Address) {
        caller.require_auth();
        commitments::require_admin(&env, &caller);
        upgrade::set_upgrade_admin(&env, new_admin);
    }

    /// Replaces this contract's executable and moves the storage schema forward,
    /// atomically and without changing the contract ID or touching stored state.
    ///
    /// # Authorization
    /// * Authorized caller: the contract admin (via `require_auth`).
    /// * Why: this entrypoint can change the behaviour of every other entrypoint, so
    ///   it is restricted to the contract admin.
    ///
    /// # Arguments
    /// * `new_wasm_hash` - Hash of an already-uploaded Wasm blob. Pinned by the
    ///   timelock at proposal time, so the code reviewed during the delay is the code
    ///   that executes.
    /// * `new_schema_version` - Schema version to move to in the same transaction.
    ///   Pass the current version to swap the executable without a schema change.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    /// * Panics with `Error::NotAdmin` if the caller is not the contract admin.
    /// * Panics with `Error::UpgradeAdminNotSet` if no upgrade admin is installed.
    /// * Panics with `Error::SchemaDowngrade` if `new_schema_version` is below the
    ///   version currently in force.
    /// * Panics with `Error::UnsupportedSchemaVersion` if `new_schema_version` is
    ///   above what this executable understands.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>, new_schema_version: u32) {
        caller.require_auth();
        commitments::require_admin(&env, &caller);
        upgrade::upgrade(&env, new_wasm_hash, new_schema_version);
    }

    pub fn get_reputation_v2(env: Env, address: Address) -> reputation::ReputationV2 {
        reputation::get_reputation_v2(&env, address)
    }

    pub fn migration_pending(env: Env, address: Address) -> bool {
        reputation::migration_pending(&env, address)
    }

    pub fn migrate_reputation_batch(env: Env, addresses: Vec<Address>) -> u32 {
        pausable::require_not_paused(&env);
        reputation::migrate_reputation_batch(&env, addresses)
    }

    pub fn get_trust_score(env: Env, address: Address) -> Option<u32> {
        trust_score::get_trust_score(&env, address)
    }

    pub fn restore_reputation(env: Env, address: Address) -> bool {
        reputation::restore_reputation(&env, address)
    }

    pub fn restore_trust_history(env: Env, address: Address) -> bool {
        trust_score::restore_trust_history(&env, address)
    }

    pub fn set_staking_token(env: Env, caller: Address, token: Address) {
        staking::set_staking_token(&env, caller, token);
    }

    pub fn set_dispute_token(env: Env, caller: Address, token: Address) {
        caller.require_auth();
        let arbitrators = crate::commitments::arbitrators(&env);
        if !arbitrators.contains(&caller) {
            panic_with_error!(env, Error::NotArbitrator);
        }
        if env.storage().instance().has(&DataKey::DisputeToken) {
            panic_with_error!(env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::DisputeToken, &token);
        env.storage().instance().extend_ttl(
            commitments::TTL_THRESHOLD_LEDGERS,
            commitments::TTL_EXTEND_LEDGERS,
        );
    }

    pub fn stake_attestor(env: Env, attestor: Address, amount: i128) {
        staking::stake_attestor(&env, attestor, amount);
    }

    pub fn request_unstake(env: Env, attestor: Address) {
        staking::request_unstake(&env, attestor);
    }

    pub fn finalize_unstake(env: Env, attestor: Address) {
        staking::finalize_unstake(&env, attestor);
    }

    pub fn get_stake_info(env: Env, attestor: Address) -> AttestorStake {
        staking::get_stake_info(&env, attestor)
    }

    pub fn configure_rollup(env: Env, caller: Address, quorum: u32, challenge_secs: u64) {
        rollup::configure_rollup(&env, caller, quorum, challenge_secs);
    }

    pub fn submit_batch_root(
        env: Env,
        submitter: Address,
        batch_root: BytesN<32>,
        batch_seq: u64,
        signers: Vec<Address>,
    ) {
        rollup::submit_batch_root(&env, submitter, batch_root, batch_seq, signers);
    }

    pub fn last_batch_seq(env: Env) -> u64 {
        rollup::last_batch_seq(&env)
    }

    pub fn get_batch_root(env: Env, batch_seq: u64) -> Option<BatchRootRecord> {
        rollup::get_batch_root(&env, batch_seq)
    }

    pub fn force_include(
        env: Env,
        submitter: Address,
        leaf_hash: BytesN<32>,
        sequence_id: u64,
        proof: Vec<MerkleNode>,
        against_batch_seq: Option<u64>,
        opened_at: u64,
        expected_batch_seq: u64,
    ) {
        rollup::force_include(
            &env,
            submitter,
            leaf_hash,
            sequence_id,
            proof,
            against_batch_seq,
            opened_at,
            expected_batch_seq,
        );
    }

    pub fn get_forced_inclusion(env: Env, leaf_hash: BytesN<32>) -> Option<ForcedInclusionRecord> {
        rollup::get_forced_inclusion(&env, leaf_hash)
    }

    pub fn update_fee_oracle(env: Env, observed_fee: i128) -> fee_oracle::OracleState {
        reentrancy::enter(&env);
        let state = fee_oracle::update_oracle(&env, observed_fee);
        events::fee_oracle_updated(&env, state.recommended_fee, env.ledger().sequence());
        reentrancy::exit(&env);
        state
    }

    pub fn get_recommended_fee(env: Env) -> i128 {
        fee_oracle::get_recommended_fee(&env).unwrap_or_else(|e| panic_with_error!(&env, e))
    }

    /// Creates multiple commitments in a single transaction.
    ///
    /// Enterprise users can register many commitments at once,
    /// saving on fees and time.
    ///
    /// # Authorization
    /// * Each `issuer` in the batch must authorize individually.
    ///
    /// # Arguments
    /// * `params` - A vector of `CommitmentParams`.
    ///
    /// # Returns
    /// * `Vec<u64>` - The unique identifiers assigned to each commitment.
    ///
    /// # Panics
    /// * Panics with `Error::BatchTooLarge` if batch size exceeds 50.
    pub fn batch_create_commitments(
        env: Env,
        params: Vec<commitments::CommitmentParams>,
    ) -> Vec<u64> {
        pausable::require_not_paused(&env);
        commitments::create_batch(&env, params)
    }
}
