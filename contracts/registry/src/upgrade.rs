//! In-place executable upgrade and storage-schema versioning (Phase B → Phase C).
//!
//! # Why there is no proxy contract here
//!
//! Soroban has no `delegatecall`, so the EVM "proxy holds storage, implementation
//! holds logic" split has no equivalent and no purpose. A Soroban contract instead
//! replaces its own executable in place via
//! [`soroban_sdk::deploy::Deployer::update_current_contract_wasm`]: the contract ID
//! and every persistent/instance storage entry survive untouched, and integrating
//! protocols keep calling the same address. That is precisely the property a proxy
//! is used to obtain on EVM, so this module implements the native mechanism and the
//! timelock contract is made the sole holder of the authority to trigger it.
//!
//! # Atomicity of the schema switch
//!
//! [`super::RegistryContract::upgrade`] flips the stored schema version *and* swaps
//! the executable in a single invocation, so both land in the same transaction or
//! neither does. The physical rewrite of individual reputation rows is deliberately
//! *not* done there — see [`crate::reputation`] for why, and for the lazy/batched
//! migration that replaces it.
//!
//! # Ordering constraint that shapes this design
//!
//! `update_current_contract_wasm` does not take effect until the invocation that
//! called it has finished. A contract therefore cannot call an entrypoint that only
//! exists in the *new* executable during the upgrade transaction. Anything that must
//! happen atomically with the upgrade has to already exist in the *old* executable —
//! which is why `upgrade` takes the target schema version as an argument rather than
//! delegating to a `migrate()` function shipped in the new Wasm.

use crate::errors::Error;
use crate::events;
use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env};

/// Schema version of the Phase B (pre-Attestor) reputation layout.
pub const SCHEMA_VERSION_V1: u32 = 1;

/// Schema version of the Phase C (Attestor-enabled) reputation layout.
pub const SCHEMA_VERSION_V2: u32 = 2;

/// Highest schema version this executable knows how to serve reads for.
///
/// `upgrade` refuses to set a version above this: doing so would leave the
/// *currently running* executable — the one that must survive until the end of the
/// upgrade transaction — unable to interpret its own storage if the transaction is
/// replayed or the new Wasm turns out to be unusable.
pub const MAX_SUPPORTED_SCHEMA_VERSION: u32 = SCHEMA_VERSION_V2;

/// Maximum number of addresses accepted by a single `migrate_reputation_batch` call.
///
/// Batches are bounded so an operator cannot build a transaction that is guaranteed
/// to exceed Soroban's per-transaction resource limits. The real ceiling is metered
/// by the network; this constant only rejects obviously-oversized batches early.
pub const MAX_MIGRATION_BATCH: u32 = 100;

/// Storage keys owned by the upgrade/governance layer.
///
/// Added as a separate enum rather than as new variants of
/// [`crate::commitments::DataKey`] so that the existing key encodings are provably
/// untouched by this change.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpgradeKey {
    /// Instance storage: the address permitted to upgrade this contract.
    /// In production this is the Timelock contract's address.
    UpgradeAdmin,
    /// Instance storage: the reputation storage schema version currently in force.
    /// Absent means [`SCHEMA_VERSION_V1`].
    SchemaVersion,
}

/// Returns the schema version currently in force.
///
/// A contract deployed before this module existed has no stored value; that is
/// indistinguishable from — and equivalent to — [`SCHEMA_VERSION_V1`].
pub fn schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&UpgradeKey::SchemaVersion)
        .unwrap_or(SCHEMA_VERSION_V1)
}

/// Returns the configured upgrade admin, or `None` if governance was never installed.
pub fn upgrade_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&UpgradeKey::UpgradeAdmin)
}

/// Loads the upgrade admin and requires its authorization.
///
/// # Panics
/// * [`Error::UpgradeAdminNotSet`] if governance has not been installed.
fn require_upgrade_admin(env: &Env) -> Address {
    let admin: Address =
        upgrade_admin(env).unwrap_or_else(|| panic_with_error!(env, Error::UpgradeAdminNotSet));
    admin.require_auth();
    admin
}

/// Installs the initial upgrade admin. Bootstrap path only.
///
/// # Authorization
/// * Authorized caller: the contract admin (via `require_auth`).
/// * Why: the contract admin is the authority responsible for managing upgrade
///   permissions. Once an upgrade admin is installed this path is permanently
///   closed and further changes must go through [`set_upgrade_admin`] — that is,
///   through the timelock.
pub fn init_upgrade_admin(env: &Env, admin: Address) {
    if env.storage().instance().has(&UpgradeKey::UpgradeAdmin) {
        panic_with_error!(env, Error::UpgradeAdminAlreadySet);
    }

    admin.require_auth();

    env.storage()
        .instance()
        .set(&UpgradeKey::UpgradeAdmin, &admin);
    extend_instance_ttl(env);

    events::upgrade_admin_changed(env, None, &admin);
}

/// Transfers upgrade authority to a different address.
///
/// # Authorization
/// * Authorized caller: the current upgrade admin.
/// * Why: rotating the address that owns every future upgrade is at least as
///   consequential as an upgrade itself, so it is routed through the same timelocked
///   authority and inherits the same 7-day public review window.
///
/// This is intentionally single-step. A two-step accept would protect against
/// mistyping the new admin, but the timelock already provides a stronger form of the
/// same protection: the new address is public and cancellable for seven days before
/// it takes effect. Handing authority to an address that cannot use it remains
/// possible and is covered in the threat model (`docs/upgradeability.md`).
pub fn set_upgrade_admin(env: &Env, new_admin: Address) {
    let old = require_upgrade_admin(env);

    env.storage()
        .instance()
        .set(&UpgradeKey::UpgradeAdmin, &new_admin);
    extend_instance_ttl(env);

    events::upgrade_admin_changed(env, Some(&old), &new_admin);
}

/// Replaces this contract's executable and moves the storage schema to
/// `new_schema_version`, atomically.
///
/// # Authorization
/// * Authorized caller: the upgrade admin (the Timelock contract).
/// * Why: this is the only entrypoint that can change what every other entrypoint
///   does, so it is gated on the one authority that cannot act without a 7-day delay.
///
/// # Panics
/// * [`Error::UpgradeAdminNotSet`] if governance has not been installed.
/// * [`Error::SchemaDowngrade`] if `new_schema_version` is below the current version.
/// * [`Error::UnsupportedSchemaVersion`] if `new_schema_version` exceeds
///   [`MAX_SUPPORTED_SCHEMA_VERSION`].
pub fn upgrade(env: &Env, new_wasm_hash: BytesN<32>, new_schema_version: u32) {
    require_upgrade_admin(env);

    let current = schema_version(env);
    if new_schema_version < current {
        panic_with_error!(env, Error::SchemaDowngrade);
    }
    if new_schema_version > MAX_SUPPORTED_SCHEMA_VERSION {
        panic_with_error!(env, Error::UnsupportedSchemaVersion);
    }

    if new_schema_version != current {
        env.storage()
            .instance()
            .set(&UpgradeKey::SchemaVersion, &new_schema_version);
    }
    extend_instance_ttl(env);

    // Emitted before the swap so the event is attributable to the *old* executable,
    // which is the code a reviewer audited during the timelock window.
    events::upgraded(env, &new_wasm_hash, current, new_schema_version);

    // Takes effect only once this invocation returns successfully. If anything after
    // this point panics, the executable is not replaced and the schema version write
    // is rolled back with the rest of the transaction.
    env.deployer().update_current_contract_wasm(new_wasm_hash);
}

/// Extends the instance TTL using the same thresholds the rest of the contract uses.
pub(crate) fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );
}
