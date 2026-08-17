#![cfg(test)]
//! Tests for in-place upgradeability and the V1 → V2 reputation migration.
//!
//! Tests that need a genuine Wasm executable swap are gated behind the `wasm-tests`
//! feature, because the Soroban host only accepts real contract Wasm and that has to
//! be built before it can be embedded. Run them with:
//!
//! ```text
//! make -C contracts test-upgrade
//! ```
//!
//! Everything that does not require an actual swap runs under a plain `cargo test`.

use super::*;
use crate::commitments::CommitmentStatus;
use crate::errors::Error;
use crate::reputation::{project_v1_to_v2, Reputation, ReputationKey, ReputationV2};
use crate::upgrade::{UpgradeKey, MAX_MIGRATION_BATCH};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{vec, Address, BytesN, Env, Vec};

/// A Wasm hash that is well-formed but not uploaded. Only used on paths that must
/// reject *before* reaching the host's executable swap.
fn dummy_wasm_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

struct Fixture {
    env: Env,
    client: RegistryContractClient<'static>,
    contract_id: Address,
    arbitrator: Address,
    timelock: Address,
}

/// Registers the registry, initializes it, and installs `timelock` as upgrade admin.
fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);

    let arbitrator = Address::generate(&env);
    let timelock = Address::generate(&env);
    client.initialize(&vec![&env, arbitrator.clone()]);
    client.init_upgrade_admin(&timelock);

    Fixture {
        env,
        client,
        contract_id,
        arbitrator,
        timelock,
    }
}

/// Writes a V1 reputation row directly, standing in for history accumulated by the
/// pre-upgrade executable.
fn seed_v1(f: &Fixture, address: &Address, fulfilled: u32, late: u32, breached: u32) {
    let rep = Reputation {
        fulfilled_count: fulfilled,
        late_count: late,
        breached_count: breached,
    };
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .set(&ReputationKey::Reputation(address.clone()), &rep);
    });
}

fn raw_v1(f: &Fixture, address: &Address) -> Option<Reputation> {
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get(&ReputationKey::Reputation(address.clone()))
    })
}

fn raw_v2(f: &Fixture, address: &Address) -> Option<ReputationV2> {
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get(&ReputationKey::ReputationV2(address.clone()))
    })
}

/// Moves the contract onto the V2 schema without performing a Wasm swap.
///
/// The swap and the schema flip are one atomic step in `upgrade`; this helper exists
/// so the migration semantics can be tested independently of the host's Wasm handling,
/// which the `wasm-tests` suite covers separately.
fn force_schema_v2(f: &Fixture) {
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&UpgradeKey::SchemaVersion, &SCHEMA_VERSION_V2);
    });
}

// -------------------------------------------------------------------------
// Schema version and upgrade-admin installation
// -------------------------------------------------------------------------

#[test]
fn test_schema_version_defaults_to_v1() {
    let f = setup();
    assert_eq!(f.client.schema_version(), SCHEMA_VERSION_V1);
}

#[test]
fn test_schema_version_defaults_to_v1_without_governance() {
    // A contract deployed before this module existed has no stored value at all.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    assert_eq!(client.schema_version(), SCHEMA_VERSION_V1);
    assert_eq!(client.get_upgrade_admin(), None);
}

#[test]
fn test_init_upgrade_admin_installs_governance() {
    let f = setup();
    assert_eq!(f.client.get_upgrade_admin(), Some(f.timelock.clone()));
}

#[test]
fn test_init_upgrade_admin_can_only_run_once() {
    let f = setup();
    let other = Address::generate(&f.env);
    let err = f
        .client
        .try_init_upgrade_admin(&other)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::UpgradeAdminAlreadySet.into());
    // The original admin is untouched.
    assert_eq!(f.client.get_upgrade_admin(), Some(f.timelock.clone()));
}

#[test]
fn test_init_upgrade_admin_fails_before_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let err = client.try_init_upgrade_admin(&admin).unwrap_err().unwrap();
    assert_eq!(err, Error::NotInitialized.into());
}

#[test]
#[should_panic]
fn test_init_upgrade_admin_requires_arbitrator_auth() {
    // No mock_all_auths: the arbitrator has not signed.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let arbitrator = Address::generate(&env);
    client.initialize(&vec![&env, arbitrator]);

    env.set_auths(&[]);
    client.init_upgrade_admin(&Address::generate(&env));
}

// -------------------------------------------------------------------------
// Upgrade authorization and argument validation
// -------------------------------------------------------------------------

#[test]
fn test_upgrade_fails_without_governance_installed() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    client.initialize(&vec![&env, Address::generate(&env)]);

    let err = client
        .try_upgrade(&dummy_wasm_hash(&env), &SCHEMA_VERSION_V2)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::UpgradeAdminNotSet.into());
}

#[test]
#[should_panic]
fn test_upgrade_requires_upgrade_admin_auth() {
    let f = setup();
    // Drop every mocked signature: nobody has authorized as the timelock.
    f.env.set_auths(&[]);
    f.client
        .upgrade(&dummy_wasm_hash(&f.env), &SCHEMA_VERSION_V2);
}

#[test]
fn test_upgrade_rejects_schema_downgrade() {
    let f = setup();
    force_schema_v2(&f);

    let err = f
        .client
        .try_upgrade(&dummy_wasm_hash(&f.env), &SCHEMA_VERSION_V1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::SchemaDowngrade.into());
    assert_eq!(f.client.schema_version(), SCHEMA_VERSION_V2);
}

#[test]
fn test_upgrade_rejects_unknown_schema_version() {
    let f = setup();
    let err = f
        .client
        .try_upgrade(&dummy_wasm_hash(&f.env), &99u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::UnsupportedSchemaVersion.into());
    assert_eq!(f.client.schema_version(), SCHEMA_VERSION_V1);
}

#[test]
#[should_panic]
fn test_set_upgrade_admin_requires_current_admin_auth() {
    let f = setup();
    f.env.set_auths(&[]);
    f.client.set_upgrade_admin(&Address::generate(&f.env));
}

#[test]
fn test_set_upgrade_admin_rotates_authority() {
    let f = setup();
    let new_timelock = Address::generate(&f.env);
    f.client.set_upgrade_admin(&new_timelock);
    assert_eq!(f.client.get_upgrade_admin(), Some(new_timelock));
}

#[test]
fn test_set_upgrade_admin_fails_without_governance_installed() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    client.initialize(&vec![&env, Address::generate(&env)]);

    let err = client
        .try_set_upgrade_admin(&Address::generate(&env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::UpgradeAdminNotSet.into());
}

// -------------------------------------------------------------------------
// V1 → V2 field mapping
// -------------------------------------------------------------------------

#[test]
fn test_v1_to_v2_mapping_preserves_counters_and_derives_direct_count() {
    let v1 = Reputation {
        fulfilled_count: 14,
        late_count: 2,
        breached_count: 1,
    };
    let v2 = project_v1_to_v2(&v1, 1_700_000_000);

    assert_eq!(v2.fulfilled_count, 14);
    assert_eq!(v2.late_count, 2);
    assert_eq!(v2.breached_count, 1);
    // Every Phase B outcome was established by a party or the arbitrator.
    assert_eq!(v2.direct_count, 17);
    // No Attestor existed in Phase B.
    assert_eq!(v2.attested_count, 0);
    assert_eq!(v2.updated_at, 1_700_000_000);
    assert_eq!(v2.version, SCHEMA_VERSION_V2);
}

#[test]
fn test_v1_to_v2_mapping_at_counter_saturation_boundary() {
    // The widest possible V1 row: `direct_count` is u64 precisely so that summing
    // three saturated u32 counters stays exact instead of clamping.
    let v1 = Reputation {
        fulfilled_count: u32::MAX,
        late_count: u32::MAX,
        breached_count: u32::MAX,
    };
    let v2 = project_v1_to_v2(&v1, 42);

    assert_eq!(v2.fulfilled_count, u32::MAX);
    assert_eq!(v2.late_count, u32::MAX);
    assert_eq!(v2.breached_count, u32::MAX);
    assert_eq!(v2.direct_count, 3 * u32::MAX as u64);
    assert!(v2.direct_count > u32::MAX as u64);
}

#[test]
fn test_v1_to_v2_mapping_of_all_zero_row() {
    let v1 = Reputation {
        fulfilled_count: 0,
        late_count: 0,
        breached_count: 0,
    };
    let v2 = project_v1_to_v2(&v1, 9);
    assert_eq!(v2.direct_count, 0);
    assert_eq!(v2.attested_count, 0);
    assert_eq!(v2.version, SCHEMA_VERSION_V2);
}

#[test]
fn test_v1_to_v2_mapping_of_single_counter_rows() {
    for (f, l, b, expected) in [(5u32, 0u32, 0u32, 5u64), (0, 5, 0, 5), (0, 0, 5, 5)] {
        let v2 = project_v1_to_v2(
            &Reputation {
                fulfilled_count: f,
                late_count: l,
                breached_count: b,
            },
            0,
        );
        assert_eq!(v2.direct_count, expected);
        assert_eq!(v2.fulfilled_count, f);
        assert_eq!(v2.late_count, l);
        assert_eq!(v2.breached_count, b);
    }
}

// -------------------------------------------------------------------------
// Migration behaviour
// -------------------------------------------------------------------------

#[test]
fn test_reads_are_identical_before_and_after_the_schema_switch() {
    let f = setup();
    let alice = Address::generate(&f.env);
    seed_v1(&f, &alice, 14, 2, 1);

    let before = f.client.get_reputation(&alice);
    force_schema_v2(&f);
    let after = f.client.get_reputation(&alice);

    // The Trust Score an integrating protocol sees does not move across the upgrade.
    assert_eq!(before, after);
    assert_eq!(after.fulfilled_count, 14);
    assert_eq!(after.late_count, 2);
    assert_eq!(after.breached_count, 1);
}

#[test]
fn test_v2_read_projects_unmigrated_row_without_writing() {
    let f = setup();
    let alice = Address::generate(&f.env);
    seed_v1(&f, &alice, 3, 1, 2);
    force_schema_v2(&f);

    let v2 = f.client.get_reputation_v2(&alice);
    assert_eq!(v2.fulfilled_count, 3);
    assert_eq!(v2.direct_count, 6);

    // Reading did not migrate anything: the row is still physically V1.
    assert!(raw_v2(&f, &alice).is_none());
    assert!(raw_v1(&f, &alice).is_some());
    assert!(f.client.migration_pending(&alice));
}

#[test]
fn test_batch_migration_rewrites_rows_and_removes_v1() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    seed_v1(&f, &alice, 14, 2, 1);
    seed_v1(&f, &bob, 0, 0, 3);
    force_schema_v2(&f);
    f.env.ledger().with_mut(|l| l.timestamp = 2_000_000);

    let migrated = f
        .client
        .migrate_reputation_batch(&vec![&f.env, alice.clone(), bob.clone()]);
    assert_eq!(migrated, 2);

    let a = raw_v2(&f, &alice).expect("alice migrated");
    assert_eq!(a.fulfilled_count, 14);
    assert_eq!(a.late_count, 2);
    assert_eq!(a.breached_count, 1);
    assert_eq!(a.direct_count, 17);
    assert_eq!(a.attested_count, 0);
    assert_eq!(a.updated_at, 2_000_000);
    assert_eq!(a.version, SCHEMA_VERSION_V2);

    let b = raw_v2(&f, &bob).expect("bob migrated");
    assert_eq!(b.breached_count, 3);
    assert_eq!(b.direct_count, 3);

    // The V1 rows are gone, so no stale value can ever be served.
    assert!(raw_v1(&f, &alice).is_none());
    assert!(raw_v1(&f, &bob).is_none());
    assert!(!f.client.migration_pending(&alice));
}

#[test]
fn test_batch_migration_is_idempotent() {
    let f = setup();
    let alice = Address::generate(&f.env);
    seed_v1(&f, &alice, 4, 0, 0);
    force_schema_v2(&f);

    let batch: Vec<Address> = vec![&f.env, alice.clone()];
    assert_eq!(f.client.migrate_reputation_batch(&batch), 1);
    // Second pass finds nothing to do and does not corrupt the row.
    assert_eq!(f.client.migrate_reputation_batch(&batch), 0);
    assert_eq!(f.client.get_reputation(&alice).fulfilled_count, 4);
}

#[test]
fn test_batch_migration_skips_addresses_with_no_row() {
    let f = setup();
    let known = Address::generate(&f.env);
    let never_seen = Address::generate(&f.env);
    seed_v1(&f, &known, 1, 1, 1);
    force_schema_v2(&f);

    let migrated =
        f.client
            .migrate_reputation_batch(&vec![&f.env, known.clone(), never_seen.clone()]);
    // Only the address that actually had history counts.
    assert_eq!(migrated, 1);

    // No phantom row was fabricated for the unknown address.
    assert!(raw_v2(&f, &never_seen).is_none());
    assert!(raw_v1(&f, &never_seen).is_none());
    let zeroed = f.client.get_reputation_v2(&never_seen);
    assert_eq!(zeroed.fulfilled_count, 0);
    assert_eq!(zeroed.direct_count, 0);
}

/// Advances the ledger just past the default persistent-entry TTL (4096 ledgers),
/// which archives a row written without an explicit extension while leaving the
/// contract instance — extended to 30 days on every call — live and callable.
fn archive_seeded_rows(f: &Fixture) {
    f.env.ledger().with_mut(|l| l.sequence_number += 4_096);
}

#[test]
#[should_panic(expected = "archived")]
fn test_archived_row_aborts_the_invocation() {
    // Pins the actual host behaviour, which is the opposite of the convenient
    // assumption: an archived persistent entry is NOT readable as absent. Touching one
    // aborts the invocation, and on the network the transaction is rejected before the
    // contract runs at all. Migration therefore cannot quietly skip archived rows —
    // the operator has to restore them in the same transaction. If a future SDK ever
    // softens this to a silent miss, this test fails and the claims in
    // `reputation.rs` and `docs/upgradeability.md` need revisiting.
    let f = setup();
    let alice = Address::generate(&f.env);
    seed_v1(&f, &alice, 9, 9, 9);
    force_schema_v2(&f);
    archive_seeded_rows(&f);

    f.client
        .migrate_reputation_batch(&vec![&f.env, alice.clone()]);
}

#[test]
#[should_panic(expected = "archived")]
fn test_archived_row_aborts_reads_too() {
    // The same applies to the read path, so `get_reputation_v2` cannot be used to
    // probe whether a row needs restoring.
    let f = setup();
    let alice = Address::generate(&f.env);
    seed_v1(&f, &alice, 1, 2, 3);
    force_schema_v2(&f);
    archive_seeded_rows(&f);

    f.client.get_reputation_v2(&alice);
}

#[test]
fn test_archival_does_not_disturb_addresses_with_live_rows() {
    // An archived row is a per-key problem, not a per-contract one: the instance stays
    // callable and other addresses migrate normally. This is what makes it safe for a
    // batch to be retried with the archived addresses removed.
    let f = setup();
    let stale = Address::generate(&f.env);
    seed_v1(&f, &stale, 9, 9, 9);
    force_schema_v2(&f);
    archive_seeded_rows(&f);

    let fresh = Address::generate(&f.env);
    seed_v1(&f, &fresh, 4, 0, 1);

    assert_eq!(f.client.schema_version(), SCHEMA_VERSION_V2);
    assert_eq!(
        f.client
            .migrate_reputation_batch(&vec![&f.env, fresh.clone()]),
        1
    );
    assert_eq!(raw_v2(&f, &fresh).unwrap().direct_count, 5);
}

#[test]
fn test_migration_rejected_while_on_v1_schema() {
    let f = setup();
    let alice = Address::generate(&f.env);
    seed_v1(&f, &alice, 1, 0, 0);

    let err = f
        .client
        .try_migrate_reputation_batch(&vec![&f.env, alice.clone()])
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MigrationNotEnabled.into());
    assert!(!f.client.migration_pending(&alice));
}

#[test]
fn test_migration_batch_size_is_bounded() {
    let f = setup();
    force_schema_v2(&f);

    let mut oversized: Vec<Address> = Vec::new(&f.env);
    for _ in 0..(MAX_MIGRATION_BATCH + 1) {
        oversized.push_back(Address::generate(&f.env));
    }
    let err = f
        .client
        .try_migrate_reputation_batch(&oversized)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::BatchTooLarge.into());

    // Exactly at the limit is accepted.
    let mut at_limit: Vec<Address> = Vec::new(&f.env);
    for _ in 0..MAX_MIGRATION_BATCH {
        at_limit.push_back(Address::generate(&f.env));
    }
    assert_eq!(f.client.migrate_reputation_batch(&at_limit), 0);
}

#[test]
fn test_write_path_migrates_lazily() {
    let f = setup();
    let issuer = Address::generate(&f.env);
    let counterparty = Address::generate(&f.env);

    // Accumulate real Phase B history through the normal flow.
    f.env.ledger().with_mut(|l| l.timestamp = 1_000);
    let id = f.client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&f.env, &[1u8; 32]),
        &2_000,
        &f.arbitrator,
        &Vec::new(&f.env),
        &0,
    );
    f.client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(f.client.get_reputation(&issuer).fulfilled_count, 1);
    assert!(raw_v1(&f, &issuer).is_some());

    force_schema_v2(&f);
    assert!(f.client.migration_pending(&issuer));

    // The next scored outcome rewrites the row in the V2 layout on its way past.
    let id2 = f.client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&f.env, &[2u8; 32]),
        &3_000,
        &f.arbitrator,
        &Vec::new(&f.env),
        &0,
    );
    f.client.attest(&issuer, &id2, &CommitmentStatus::Late);

    assert!(!f.client.migration_pending(&issuer));
    let v2 = raw_v2(&f, &issuer).expect("row migrated on write");
    assert_eq!(v2.fulfilled_count, 1);
    assert_eq!(v2.late_count, 1);
    // One outcome carried over from V1, one recorded under V2.
    assert_eq!(v2.direct_count, 2);
    assert_eq!(v2.attested_count, 0);
    assert!(raw_v1(&f, &issuer).is_none());
}

#[test]
fn test_v2_write_path_decrements_direct_count_on_dispute() {
    let f = setup();
    let issuer = Address::generate(&f.env);
    let counterparty = Address::generate(&f.env);
    force_schema_v2(&f);

    f.env.ledger().with_mut(|l| l.timestamp = 1_000);
    let id = f.client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&f.env, &[3u8; 32]),
        &2_000,
        &f.arbitrator,
        &Vec::new(&f.env),
        &0,
    );
    f.client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(raw_v2(&f, &issuer).unwrap().direct_count, 1);

    // Raising a dispute retracts the outcome, and the derived counter follows it.
    f.client.dispute(&counterparty, &id);
    let after = raw_v2(&f, &issuer).unwrap();
    assert_eq!(after.fulfilled_count, 0);
    assert_eq!(after.direct_count, 0);

    // Resolution re-applies it.
    f.client
        .resolve_dispute(&f.arbitrator, &id, &CommitmentStatus::Breached);
    let resolved = raw_v2(&f, &issuer).unwrap();
    assert_eq!(resolved.breached_count, 1);
    assert_eq!(resolved.direct_count, 1);
}

#[test]
fn test_commitments_are_untouched_by_the_schema_switch() {
    let f = setup();
    let issuer = Address::generate(&f.env);
    let counterparty = Address::generate(&f.env);

    f.env.ledger().with_mut(|l| l.timestamp = 1_000);
    let terms = BytesN::from_array(&f.env, &[9u8; 32]);
    let id = f.client.create_commitment(
        &issuer,
        &counterparty,
        &terms,
        &2_000,
        &f.arbitrator,
        &Vec::new(&f.env),
        &0,
    );
    let before = f.client.get_commitment(&id);

    force_schema_v2(&f);

    // Commitment storage has no V2 variant; the schema switch only concerns
    // reputation rows, and commitments must read back byte-identical.
    assert_eq!(f.client.get_commitment(&id), before);
    assert_eq!(f.client.get_arbitrator(), f.arbitrator);
}

// -------------------------------------------------------------------------
// Real executable swap — requires the Wasm artifacts to have been built.
// -------------------------------------------------------------------------

#[cfg(feature = "wasm-tests")]
mod wasm {
    use super::*;

    /// A second, independently compiled contract to upgrade *to*.
    ///
    /// The Soroban host rejects synthetic Wasm blobs, so proving that an executable
    /// swap really happened requires a genuine second binary. `contractimport!` embeds
    /// the built artifact, which is why these tests are feature-gated behind a build
    /// step rather than running under a bare `cargo test`.
    mod fixture_contract {
        soroban_sdk::contractimport!(
            file = "../target/wasm32-unknown-unknown/release/upgrade_fixture.wasm"
        );
    }

    struct WasmFixture {
        env: Env,
        contract_id: Address,
        client: RegistryContractClient<'static>,
        arbitrator: Address,
        timelock: Address,
    }

    fn setup_wasm() -> WasmFixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000);

        let contract_id = env.register(RegistryContract, ());
        let client = RegistryContractClient::new(&env, &contract_id);
        let arbitrator = Address::generate(&env);
        let timelock = Address::generate(&env);
        client.initialize(&vec![&env, arbitrator.clone()]);
        client.init_upgrade_admin(&timelock);

        WasmFixture {
            env,
            contract_id,
            client,
            arbitrator,
            timelock,
        }
    }

    /// Builds a Trust Score of 2 fulfilled / 1 late / 1 breached for `issuer`.
    fn accumulate_history(f: &WasmFixture, issuer: &Address, counterparty: &Address) {
        for (i, outcome) in [
            CommitmentStatus::Fulfilled,
            CommitmentStatus::Fulfilled,
            CommitmentStatus::Late,
            CommitmentStatus::Breached,
        ]
        .iter()
        .enumerate()
        {
            let id = f.client.create_commitment(
                issuer,
                counterparty,
                &BytesN::from_array(&f.env, &[i as u8; 32]),
                &2_000,
                &f.arbitrator,
                &Vec::new(&f.env),
                &0,
            );
            f.client.attest(issuer, &id, outcome);
        }
    }

    #[test]
    fn test_upgrade_swaps_the_executable_and_preserves_trust_scores() {
        // The headline acceptance criterion: logic is replaced, the contract ID does
        // not move, and existing Trust Scores survive intact.
        let f = setup_wasm();
        let issuer = Address::generate(&f.env);
        let counterparty = Address::generate(&f.env);
        accumulate_history(&f, &issuer, &counterparty);

        let before = f.client.get_reputation(&issuer);
        assert_eq!(before.fulfilled_count, 2);
        assert_eq!(before.late_count, 1);
        assert_eq!(before.breached_count, 1);

        let new_hash = f
            .env
            .deployer()
            .upload_contract_wasm(fixture_contract::WASM);
        f.client.upgrade(&new_hash, &SCHEMA_VERSION_V2);

        // Same address, different code: the fixture answers an entrypoint the registry
        // does not have, which is positive evidence the swap actually took effect.
        let after = fixture_contract::Client::new(&f.env, &f.contract_id);
        assert_eq!(after.fixture_marker(), 0xC0FFEE);

        // The schema flip landed in the same transaction as the swap.
        assert_eq!(after.read_schema_version(), Some(SCHEMA_VERSION_V2));
        assert_eq!(after.read_upgrade_admin(), Some(f.timelock.clone()));

        // The Trust Score is readable by a separately compiled binary that shares only
        // the storage key and value *declarations* — a real cross-binary compatibility
        // check rather than a shared-types tautology.
        let preserved = after
            .read_v1(&issuer)
            .expect("V1 reputation row survived the executable swap");
        assert_eq!(preserved.fulfilled_count, 2);
        assert_eq!(preserved.late_count, 1);
        assert_eq!(preserved.breached_count, 1);
    }

    #[test]
    fn test_upgrade_preserves_commitments_and_the_id_counter() {
        let f = setup_wasm();
        let issuer = Address::generate(&f.env);
        let counterparty = Address::generate(&f.env);
        let terms = BytesN::from_array(&f.env, &[42u8; 32]);
        let id = f.client.create_commitment(
            &issuer,
            &counterparty,
            &terms,
            &2_000,
            &f.arbitrator,
            &Vec::new(&f.env),
            &0,
        );

        let new_hash = f
            .env
            .deployer()
            .upload_contract_wasm(fixture_contract::WASM);
        f.client.upgrade(&new_hash, &SCHEMA_VERSION_V2);

        let after = fixture_contract::Client::new(&f.env, &f.contract_id);
        let commitment = after
            .read_commitment(&id)
            .expect("commitment survived the executable swap");
        assert_eq!(commitment.issuer, issuer);
        assert_eq!(commitment.counterparty, counterparty);
        assert_eq!(commitment.terms_hash, terms);
        assert_eq!(commitment.due_at, 2_000);
        assert_eq!(
            commitment.status,
            fixture_contract::CommitmentStatus::Pending
        );

        // Instance storage survives too, so the next contract cannot reissue id 1.
        assert_eq!(after.read_next_id(), Some(id + 1));
        assert_eq!(
            after.read_arbitrators(),
            Some(vec![&f.env, f.arbitrator.clone()])
        );
        // The legacy single-arbitrator key was never written by this deployment.
        assert_eq!(after.read_arbitrator(), None);
    }

    #[test]
    fn test_upgrade_preserves_milestone_records() {
        let f = setup_wasm();
        let issuer = Address::generate(&f.env);
        let counterparty = Address::generate(&f.env);
        let terms = BytesN::from_array(&f.env, &[7u8; 32]);
        let id = f.client.create_milestone_commitment(
            &issuer,
            &counterparty,
            &terms,
            &2_000,
            &f.arbitrator,
            &3,
            &Vec::new(&f.env),
            &0,
        );
        f.client
            .attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
        f.client
            .attest_milestone(&issuer, &id, &1, &CommitmentStatus::Late);

        let new_hash = f
            .env
            .deployer()
            .upload_contract_wasm(fixture_contract::WASM);
        f.client.upgrade(&new_hash, &SCHEMA_VERSION_V2);

        let after = fixture_contract::Client::new(&f.env, &f.contract_id);

        // The per-milestone entries are readable by an independently compiled binary.
        assert_eq!(
            after.read_milestone(&id, &0),
            Some(fixture_contract::CommitmentStatus::Fulfilled)
        );
        assert_eq!(
            after.read_milestone(&id, &1),
            Some(fixture_contract::CommitmentStatus::Late)
        );
        assert_eq!(after.read_milestone(&id, &2), None);

        // And so are the counters that drive resolution.
        let commitment = after
            .read_commitment(&id)
            .expect("milestone commitment survived the executable swap");
        assert_eq!(commitment.milestone_count, 3);
        assert_eq!(commitment.milestones_attested, 2);
        assert_eq!(commitment.late_milestones, 1);
        assert_eq!(
            commitment.status,
            fixture_contract::CommitmentStatus::Pending
        );
    }

    #[test]
    fn test_upgrade_without_a_schema_change_is_allowed() {
        // The shape of an ordinary bug-fix release: swap the code, leave the schema.
        let f = setup_wasm();
        let new_hash = f
            .env
            .deployer()
            .upload_contract_wasm(fixture_contract::WASM);
        f.client.upgrade(&new_hash, &SCHEMA_VERSION_V1);

        let after = fixture_contract::Client::new(&f.env, &f.contract_id);
        assert_eq!(after.fixture_marker(), 0xC0FFEE);
        // Never written, because the version did not change.
        assert_eq!(after.read_schema_version(), None);
    }

    #[test]
    fn test_migrated_rows_are_readable_by_the_new_executable() {
        // Rows already rewritten under V2 must remain readable after the swap. This is
        // the state the ledger is in whenever a batch migration has drained part of the
        // backlog before the *next* release ships.
        let g = setup_wasm();
        let issuer2 = Address::generate(&g.env);
        let counterparty2 = Address::generate(&g.env);
        accumulate_history(&g, &issuer2, &counterparty2);
        g.env.as_contract(&g.contract_id, || {
            g.env
                .storage()
                .instance()
                .set(&UpgradeKey::SchemaVersion, &SCHEMA_VERSION_V2);
        });
        assert_eq!(
            g.client
                .migrate_reputation_batch(&vec![&g.env, issuer2.clone()]),
            1
        );

        let hash2 = g
            .env
            .deployer()
            .upload_contract_wasm(fixture_contract::WASM);
        g.client.upgrade(&hash2, &SCHEMA_VERSION_V2);

        let after = fixture_contract::Client::new(&g.env, &g.contract_id);
        let v2 = after
            .read_v2(&issuer2)
            .expect("V2 reputation row survived the executable swap");
        assert_eq!(v2.fulfilled_count, 2);
        assert_eq!(v2.late_count, 1);
        assert_eq!(v2.breached_count, 1);
        assert_eq!(v2.direct_count, 4);
        assert_eq!(v2.attested_count, 0);
        assert_eq!(v2.version, SCHEMA_VERSION_V2);
        // The V1 row was consumed by the migration.
        assert_eq!(after.read_v1(&issuer2), None);
    }
}
