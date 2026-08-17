#![no_std]

pub mod attestation;
pub mod commitments;
pub mod disputes;
pub mod errors;
pub mod events;
mod reentrancy;
pub mod reputation;
pub mod trust_gate;
pub mod trust_score;
pub mod upgrade;

#[cfg(test)]
mod test_trust_score;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_upgrade;

#[cfg(test)]
mod attacker_gate;

#[cfg(test)]
mod demo;

pub use commitments::{Commitment, CommitmentStatus, DataKey, DISPUTE_WINDOW_SECONDS};
pub use upgrade::{SCHEMA_VERSION_V1, SCHEMA_VERSION_V2};
use errors::Error;
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, BytesN, Env, Vec};

/// The Pactum Registry contract for recording and tracking recurring commitments.
#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    /// Initializes the contract with a committee of designated arbitrators.
    /// Can only be called once.
    ///
    /// Disputes on commitments that delegate to the committee are settled by a
    /// majority vote of this set rather than by a single point of trust.
    ///
    /// # Authorization
    /// * Authorized caller: every address in `arbitrators` (via `require_auth`).
    /// * Why: Requiring each designated arbitrator to authorize initialization
    ///   ensures that no address can be appointed to the committee without its
    ///   explicit consent.
    ///
    /// # Panics
    /// * Panics with `Error::AlreadyInitialized` if called more than once.
    /// * Panics with `Error::EmptyArbitratorSet` if `arbitrators` is empty.
    pub fn initialize(env: Env, arbitrators: Vec<Address>) {
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

        // Enter the reentrancy guard before any external interaction (including
        // the require_auth call below, which may invoke a custom account contract).
        reentrancy::enter(&env);

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

        // Release the reentrancy guard.
        reentrancy::exit(&env);
    }

    /// Retrieves the full set of designated arbitrators.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        let arbitrators = commitments::arbitrators(&env);

        env.storage().instance().extend_ttl(
            commitments::TTL_THRESHOLD_LEDGERS,
            commitments::TTL_EXTEND_LEDGERS,
        );

        arbitrators
    }

    /// Retrieves the first designated arbitrator.
    ///
    /// Kept for backwards compatibility with the original single-arbitrator
    /// interface; prefer [`RegistryContract::get_arbitrators`] for the full set.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
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

    /// Creates and registers a new ongoing commitment between an issuer and a counterparty.
    ///
    /// # Authorization
    /// * Authorized caller: `issuer` (via `require_auth`).
    /// * Why: Only the party issuing (promising) the commitment should be able to create
    ///   and bind themselves to a new commitment on-chain.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `issuer` - The address making the commitment. Must authorize the call.
    /// * `counterparty` - The address to whom the commitment is owed.
    /// * `terms_hash` - A 32-byte hash representing the off-chain terms of the commitment.
    /// * `due_at` - Unix timestamp (seconds) when the commitment is due. Must be in the future.
    /// * `resolver_address` - The address of the custom resolver delegated to resolve disputes for this commitment.
    ///
    /// # Returns
    /// * `u64` - The unique identifier assigned to the created commitment.
    ///
    /// # Panics
    /// * Panics with `Error::DueAtInPast` if `due_at` is less than or equal to the current ledger timestamp.
    pub fn create_commitment(
        env: Env,
        issuer: Address,
        counterparty: Address,
        terms_hash: BytesN<32>,
        due_at: u64,
        resolver_address: Address,
        oracle: Option<Address>,
        schema_id: Option<u32>,
    ) -> u64 {
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
        )
    }

    /// Creates a commitment that is fulfilled across `milestone_count` partial
    /// attestations rather than a single one.
    ///
    /// # Authorization
    /// * Authorized caller: `issuer` (via `require_auth`).
    /// * Why: Only the party issuing (promising) the commitment should be able to create
    ///   and bind themselves to a new commitment on-chain.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `issuer` - The address making the commitment. Must authorize the call.
    /// * `counterparty` - The address to whom the commitment is owed.
    /// * `terms_hash` - A 32-byte hash representing the off-chain terms of the commitment.
    /// * `due_at` - Unix timestamp (seconds) when the commitment is due. Must be in the future.
    /// * `resolver_address` - The address of the custom resolver delegated to resolve disputes.
    /// * `milestone_count` - How many milestones the commitment is split into.
    /// * `oracle` - Optional designated oracle for automated attestation.
    /// * `schema_id` - Optional identifier for the schema used to generate terms_hash.
    ///
    /// # Returns
    /// * `u64` - The unique identifier assigned to the created commitment.
    ///
    /// # Panics
    /// * Panics with `Error::DueAtInPast` if `due_at` is less than or equal to the current ledger timestamp.
    /// * Panics with `Error::InvalidMilestoneCount` if `milestone_count` is zero or above
    ///   `commitments::MAX_MILESTONES`.
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
    ) -> u64 {
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
        )
    }

    /// Retrieves an existing commitment by its unique ID.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment to retrieve.
    ///
    /// # Returns
    /// * `Commitment` - The commitment details and status.
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the ID does not exist in storage.
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

    /// Explicitly migrates a legacy commitment record to include resolver_address.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment to migrate.
    ///
    /// # Returns
    /// * `Commitment` - The migrated commitment.
    pub fn migrate_commitment(env: Env, id: u64) -> Commitment {
        Self::get_commitment(env, id)
    }

    /// Attests to the lifecycle status of a commitment.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be either the
    ///   commitment's `issuer` or `counterparty`.
    /// * Why: Only the participating parties involved in the commitment are authorized
    ///   to attest to its outcome.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The address attesting to the commitment. Must authorize the call and be issuer or counterparty.
    /// * `id` - The unique identifier of the commitment to attest.
    /// * `outcome` - The new lifecycle status (`Fulfilled`, `Late`, or `Breached`).
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    /// * Panics with `Error::Unauthorized` if `caller` is neither `issuer` nor `counterparty`.
    /// * Panics with `Error::InvalidOutcome` if `outcome` is `CommitmentStatus::Pending` or `Disputed`.
    /// * Panics with `Error::AlreadyResolved` if the commitment is not currently `Pending`.
    pub fn attest(env: Env, caller: Address, id: u64, outcome: CommitmentStatus) {
        attestation::attest(&env, caller, id, outcome);
    }

    /// Attests a single milestone of a commitment.
    ///
    /// The commitment as a whole stays `Pending` until the final milestone is
    /// attested, at which point it becomes `Fulfilled`, or `Late` if any
    /// milestone came in late. A `Breached` milestone resolves the whole
    /// commitment as `Breached` immediately.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be either the
    ///   commitment's `issuer` or `counterparty`.
    /// * Why: Only the participating parties involved in the commitment are authorized
    ///   to attest to its outcome.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The address attesting to the milestone. Must authorize the call and be issuer or counterparty.
    /// * `id` - The unique identifier of the commitment to attest.
    /// * `milestone_index` - Zero-based index of the milestone. Milestones are attested in order.
    /// * `outcome` - The milestone status (`Fulfilled`, `Late`, or `Breached`).
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    /// * Panics with `Error::Unauthorized` if `caller` is neither `issuer` nor `counterparty`.
    /// * Panics with `Error::InvalidOutcome` if `outcome` is `CommitmentStatus::Pending` or `Disputed`.
    /// * Panics with `Error::AlreadyResolved` if the commitment is not currently `Pending`.
    /// * Panics with `Error::InvalidMilestoneIndex` if `milestone_index` is outside the commitment's range.
    /// * Panics with `Error::MilestoneAlreadyAttested` if that milestone was already attested.
    /// * Panics with `Error::MilestoneOutOfOrder` if an earlier milestone is still pending.
    pub fn attest_milestone(
        env: Env,
        caller: Address,
        id: u64,
        milestone_index: u32,
        outcome: CommitmentStatus,
    ) {
        attestation::attest_milestone(&env, caller, id, milestone_index, outcome);
    }

    /// Retrieves the attested outcome of a single milestone.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    /// * `milestone_index` - Zero-based index of the milestone.
    ///
    /// # Returns
    /// * `Option<CommitmentStatus>` - The milestone's outcome, or `None` while it is pending.
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    /// * Panics with `Error::InvalidMilestoneIndex` if `milestone_index` is outside the commitment's range.
    pub fn get_milestone(env: Env, id: u64, milestone_index: u32) -> Option<CommitmentStatus> {
        attestation::get_milestone(&env, id, milestone_index)
    }

    /// Checks whether a commitment is overdue.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment to check.
    ///
    /// # Returns
    /// * `bool` - True if the commitment is still `Pending` and the ledger timestamp is greater than `due_at`.
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    pub fn is_overdue(env: Env, id: u64) -> bool {
        attestation::is_overdue(&env, id)
    }

    /// Raises a dispute on an attested commitment within the dispute window.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be either the
    ///   commitment's `issuer` or `counterparty`.
    /// * Why: Only the participating parties to the commitment have standing to contest
    ///   an attested outcome and initiate a dispute.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The address initiating the dispute. Must authorize the call.
    /// * `id` - The unique identifier of the commitment to dispute.
    pub fn dispute(env: Env, caller: Address, id: u64) {
        disputes::dispute(&env, caller, id);
    }

    /// Resolves a disputed commitment to a final outcome.
    ///
    /// A commitment whose `resolver_address` is a custom resolver outside the
    /// arbitrator committee is settled directly by that resolver. A commitment
    /// that names an arbitrator as its resolver is settled by majority vote of
    /// the committee: each call records the calling arbitrator's vote and the
    /// dispute only finalizes once the votes for an outcome exceed half the
    /// committee size.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must either be the
    ///   commitment's designated custom `resolver_address`, or a member of the
    ///   arbitrator committee for a committee-routed commitment.
    /// * Why: Dispute resolution authority is delegated either to the resolver
    ///   chosen at creation time, or to a majority of the mutually trusted
    ///   arbitrators — never a single point of trust.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The resolver or arbitrator casting the vote/resolution. Must authorize the call.
    /// * `id` - The unique identifier of the disputed commitment.
    /// * `final_outcome` - The resolution status (`Fulfilled`, `Late`, or `Breached`).
    pub fn resolve_dispute(
        env: Env,
        caller: Address,
        id: u64,
        final_outcome: CommitmentStatus,
    ) {
        disputes::resolve_dispute(&env, caller, id, final_outcome);
    }

    /// Retrieves the aggregate reputation for a given address.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `address` - The address to query.
    ///
    /// # Returns
    /// * `Reputation` - The accumulated fulfilled, late, and breached counts for the address as an issuer.
    pub fn get_reputation(env: Env, address: Address) -> reputation::Reputation {
        reputation::get_reputation(&env, address)
    }

    // ---------------------------------------------------------------------
    // Upgradeability and governance
    //
    // Soroban upgrades a contract by replacing its executable in place; the
    // contract ID and all persistent storage survive. There is therefore no proxy
    // contract in this design — see `upgrade.rs` and `docs/upgradeability.md` for
    // why the EVM proxy/implementation split is neither available nor needed here.
    // ---------------------------------------------------------------------

    /// Retrieves the reputation storage schema version currently in force.
    ///
    /// Returns [`SCHEMA_VERSION_V1`] for a contract that has never been upgraded.
    pub fn schema_version(env: Env) -> u32 {
        upgrade::schema_version(&env)
    }

    /// Retrieves the address permitted to upgrade this contract, if one is installed.
    pub fn get_upgrade_admin(env: Env) -> Option<Address> {
        upgrade::upgrade_admin(&env)
    }

    /// Installs the initial upgrade admin — in production, the Timelock contract.
    ///
    /// # Authorization
    /// * Authorized caller: the `arbitrators` recorded by `initialize` (via `require_auth`).
    /// * Why: at bootstrap no upgrade admin exists yet to authorize its own creation,
    ///   and the arbitrator committee is the only authority the contract already trusts. The path
    ///   closes permanently once used; later changes go through `set_upgrade_admin`,
    ///   which only the timelock can call.
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
    /// * Authorized caller: the current upgrade admin (via `require_auth`).
    /// * Why: rotating the owner of every future upgrade is as consequential as an
    ///   upgrade, so it is subject to the same timelocked authority and therefore to
    ///   the same 7-day public review window.
    ///
    /// # Panics
    /// * Panics with `Error::UpgradeAdminNotSet` if no upgrade admin is installed.
    pub fn set_upgrade_admin(env: Env, new_admin: Address) {
        upgrade::set_upgrade_admin(&env, new_admin);
    }

    /// Replaces this contract's executable and moves the storage schema forward,
    /// atomically and without changing the contract ID or touching stored state.
    ///
    /// # Authorization
    /// * Authorized caller: the upgrade admin (via `require_auth`) — the Timelock.
    /// * Why: this entrypoint can change the behaviour of every other entrypoint, so
    ///   it is restricted to the one authority that cannot act without a 7-day delay.
    ///
    /// # Arguments
    /// * `new_wasm_hash` - Hash of an already-uploaded Wasm blob. Pinned by the
    ///   timelock at proposal time, so the code reviewed during the delay is the code
    ///   that executes.
    /// * `new_schema_version` - Schema version to move to in the same transaction.
    ///   Pass the current version to swap the executable without a schema change.
    ///
    /// # Panics
    /// * Panics with `Error::UpgradeAdminNotSet` if no upgrade admin is installed.
    /// * Panics with `Error::SchemaDowngrade` if `new_schema_version` is below the
    ///   version currently in force.
    /// * Panics with `Error::UnsupportedSchemaVersion` if `new_schema_version` is
    ///   above what this executable understands.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>, new_schema_version: u32) {
        upgrade::upgrade(&env, new_wasm_hash, new_schema_version);
    }

    /// Retrieves the Attestor-enabled (V2) reputation for an address.
    ///
    /// Serves correct V2 data whether or not the address's row has physically been
    /// migrated, and reads as all-zero for an address that has never been scored.
    pub fn get_reputation_v2(env: Env, address: Address) -> reputation::ReputationV2 {
        reputation::get_reputation_v2(&env, address)
    }

    /// Returns true if `address` still holds a V1 row awaiting rewrite as V2.
    ///
    /// Always false while the contract is on schema V1.
    pub fn migration_pending(env: Env, address: Address) -> bool {
        reputation::migration_pending(&env, address)
    }

    /// Rewrites a bounded batch of V1 reputation rows into the V2 layout.
    ///
    /// # Authorization
    /// * Authorized caller: none — permissionless by design.
    /// * Why: migration is idempotent, cannot alter any counter's value, and the
    ///   caller pays the fees, so opening it prevents the DAO from being a liveness
    ///   bottleneck for the backlog.
    ///
    /// # Returns
    /// * `u32` - How many rows were actually rewritten. Addresses already on V2, and
    ///   addresses with no live row (never scored, or archived), count as zero.
    ///
    /// # Panics
    /// * Panics with `Error::MigrationNotEnabled` if the contract is still on schema V1.
    /// * Panics with `Error::BatchTooLarge` if the batch exceeds
    ///   `upgrade::MAX_MIGRATION_BATCH` addresses.
    pub fn migrate_reputation_batch(env: Env, addresses: Vec<Address>) -> u32 {
        reputation::migrate_reputation_batch(&env, addresses)
    }

    /// Retrieves the 0..=100 trust score for a given address as an issuer.
    ///
    /// The score weights recent outcomes more heavily than old ones via an
    /// integer, ledger-bucket-based decay curve (half-life of 64 buckets of
    /// 10,000 ledgers each, full decay after ~3.2 years). Outcomes are
    /// aggregated per bucket so this runs in O(1) storage reads.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `address` - The address to query.
    ///
    /// # Returns
    /// * `u32` - The trust score in the range 0..=100 (50 = neutral baseline).
    pub fn get_trust_score(env: Env, address: Address) -> u32 {
        trust_score::get_trust_score(&env, address)
    }
}
