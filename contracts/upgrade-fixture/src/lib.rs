#![no_std]
//! Test-only stand-in for the Phase C registry executable.
//!
//! This crate exists solely so that the upgrade path can be tested against a *real*
//! Wasm swap rather than a mock. The Soroban host will not accept a synthetic Wasm
//! blob, so proving "the executable was replaced and the storage survived" requires an
//! actual second contract binary to upgrade *to*.
//!
//! It is deliberately not part of the deployed system, and nothing in `registry` or
//! `timelock` depends on it.
//!
//! # What it proves
//!
//! The storage types below are **re-declared from scratch**, not imported from
//! `registry`. That is the point: if this contract can read entries written by the
//! registry executable, then the storage keys and value layouts are genuinely
//! compatible across two independently compiled binaries — which is exactly the
//! property an upgrade depends on and the one a shared `use registry::...` would hide.
//!
//! `#[contracttype]` encodes an enum variant by its *name* and a struct field by its
//! *name*, so adding `ReputationV2` alongside `Reputation` cannot disturb entries
//! already written under the `Reputation` variant. The tests in
//! `registry/src/test_upgrade.rs` assert this end to end.

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Vec};

/// Mirror of `registry::reputation::Reputation` (V1).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reputation {
    pub fulfilled_count: u32,
    pub late_count: u32,
    pub breached_count: u32,
}

/// Mirror of `registry::reputation::ReputationV2`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationV2 {
    pub fulfilled_count: u32,
    pub late_count: u32,
    pub breached_count: u32,
    pub direct_count: u64,
    pub attested_count: u64,
    pub updated_at: u64,
    pub version: u32,
}

/// Mirror of `registry::reputation::ReputationKey`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReputationKey {
    Reputation(Address),
    ReputationV2(Address),
}

/// Mirror of `registry::upgrade::UpgradeKey`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpgradeKey {
    UpgradeAdmin,
    SchemaVersion,
}

/// Mirror of `registry::commitments::CommitmentStatus`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitmentStatus {
    Pending,
    Fulfilled,
    Late,
    Breached,
    Disputed,
}

/// Mirror of `registry::commitments::Commitment`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Commitment {
    pub id: u64,
    pub issuer: Address,
    pub counterparty: Address,
    pub terms_hash: BytesN<32>,
    pub due_at: u64,
    pub status: CommitmentStatus,
    pub created_at: u64,
    pub attested_at: Option<u64>,
    pub resolver_address: Address,
    pub milestone_count: u32,
    pub milestones_attested: u32,
    pub late_milestones: u32,
    pub attestors: Vec<Address>,
    pub vote_threshold: u32,
}

/// Mirror of `registry::commitments::DataKey`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Commitment(u64),
    Milestone(u64, u32),
    NextId,
    ArbitratorSet,
    Arbitrator,
    Votes(u64),
}

/// A contract that reads Pactum registry state without being the Pactum registry.
#[contract]
pub struct UpgradeFixture;

#[contractimpl]
impl UpgradeFixture {
    /// Marker proving which executable is currently installed at a contract ID.
    ///
    /// The registry has no such entrypoint, so a successful call to this on the
    /// registry's address is positive evidence that the Wasm swap actually happened.
    pub fn fixture_marker(_env: Env) -> u32 {
        0xC0FFEE
    }

    /// Reads the V1 reputation row written by the pre-upgrade executable.
    pub fn read_v1(env: Env, address: Address) -> Option<Reputation> {
        env.storage()
            .persistent()
            .get(&ReputationKey::Reputation(address))
    }

    /// Reads the V2 reputation row.
    pub fn read_v2(env: Env, address: Address) -> Option<ReputationV2> {
        env.storage()
            .persistent()
            .get(&ReputationKey::ReputationV2(address))
    }

    /// Reads the schema version the registry recorded during its upgrade.
    pub fn read_schema_version(env: Env) -> Option<u32> {
        env.storage().instance().get(&UpgradeKey::SchemaVersion)
    }

    /// Reads the upgrade admin the registry had installed.
    pub fn read_upgrade_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&UpgradeKey::UpgradeAdmin)
    }

    /// Reads a commitment written by the pre-upgrade executable.
    pub fn read_commitment(env: Env, id: u64) -> Option<Commitment> {
        env.storage().persistent().get(&DataKey::Commitment(id))
    }

    /// Reads a milestone outcome written by the pre-upgrade executable.
    pub fn read_milestone(env: Env, id: u64, milestone_index: u32) -> Option<CommitmentStatus> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(id, milestone_index))
    }

    /// Reads the commitment id counter, proving it did not reset across the upgrade.
    pub fn read_next_id(env: Env) -> Option<u64> {
        env.storage().instance().get(&DataKey::NextId)
    }

    /// Reads the arbitrator set recorded at initialization.
    pub fn read_arbitrators(env: Env) -> Option<Vec<Address>> {
        env.storage().instance().get(&DataKey::ArbitratorSet)
    }

    /// Reads the legacy single-arbitrator key, if a pre-multi-arbitrator
    /// deployment ever wrote one.
    pub fn read_arbitrator(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Arbitrator)
    }
}
