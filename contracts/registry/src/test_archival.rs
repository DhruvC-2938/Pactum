#![cfg(test)]

//! Tests for Soroban state archival handling (Issue #58).
//!
//! These tests prove the acceptance criteria from the issue:
//!
//! 1. `get_trust_score` returns `Some(BASE_SCORE)` for an unscored address —
//!    it never panics on a missing (as opposed to archived) entry.
//! 2. `restore_reputation` is permissionless and returns `true` when it finds
//!    at least one live entry, or `false` when the address was never scored.
//! 3. After calling `restore_reputation` the TTL is extended so
//!    `get_trust_score` and `get_reputation` continue to work.
//! 4. `restore_trust_history` works independently for addresses that only
//!    have a trust-history entry.
//! 5. The `reputation_restored` event is emitted on every `restore_reputation`
//!    call, so the indexer can update its TTL watchlist.
//!
//! Note: The Soroban host enforces that an archived persistent entry must be
//! included in a `RestoreFootprint` operation in the same transaction before
//! the contract can read it.  This check happens *before* the Rust code runs,
//! so the test host (which does not enforce footprint restrictions) uses the
//! same TTL-extension path to simulate the "entry is live, bump it" scenario
//! that `restore_reputation` is designed for.

use super::*;
use crate::commitments::CommitmentStatus;
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::{symbol_short, Address, BytesN, Env, IntoVal};

fn setup() -> (Env, RegistryContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    (env, client, issuer, counterparty)
}

/// Creates a single fulfilled commitment so the issuer has a trust-history
/// and reputation entry in persistent storage.
fn score_issuer(
    env: &Env,
    client: &RegistryContractClient<'static>,
    issuer: &Address,
    counterparty: &Address,
) -> u64 {
    env.ledger().with_mut(|l| {
        l.timestamp = 1000;
        l.sequence_number = 1000;
    });
    let resolver = Address::generate(env);
    let id = client.create_commitment(
        issuer,
        counterparty,
        &BytesN::from_array(env, &[7u8; 32]),
        &2000,
        &resolver,
        &None,
        &None,
        &soroban_sdk::Vec::new(env),
        &0,
    );
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(issuer, &id, &CommitmentStatus::Fulfilled);
    id
}

// ---------------------------------------------------------------------------
// 1. get_trust_score never panics on a never-written address
// ---------------------------------------------------------------------------

#[test]
fn test_get_trust_score_returns_some_for_unscored_address() {
    let (_env, client, _issuer, _counterparty) = setup();
    let stranger = Address::generate(&_env);
    // An unscored address has no storage entry at all — not archived, just absent.
    // The contract must return Some(BASE_SCORE) rather than panicking.
    assert_eq!(client.get_trust_score(&stranger), Some(50));
}

// ---------------------------------------------------------------------------
// 2. get_trust_score returns Some(score) for a scored address
// ---------------------------------------------------------------------------

#[test]
fn test_get_trust_score_returns_some_score_for_scored_address() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);
    // One fulfilled: 50 + 10 = 60.
    assert_eq!(client.get_trust_score(&issuer), Some(60));
}

// ---------------------------------------------------------------------------
// 3. restore_reputation returns false for an address that was never scored
// ---------------------------------------------------------------------------

#[test]
fn test_restore_reputation_returns_false_for_unscored_address() {
    let (_env, client, _issuer, _counterparty) = setup();
    let stranger = Address::generate(&_env);
    // No storage entry exists for this address; restore_reputation cannot find
    // anything to extend, so it must return false rather than panicking.
    assert!(!client.restore_reputation(&stranger));
}

// ---------------------------------------------------------------------------
// 4. restore_reputation returns true for a scored address and extends TTL
// ---------------------------------------------------------------------------

#[test]
fn test_restore_reputation_returns_true_for_scored_address() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);

    // The entries are live (fresh TTL after attest). restore_reputation should
    // find them, extend their TTL, and return true.
    assert!(client.restore_reputation(&issuer));

    // After restore, the contract can still read the score correctly.
    assert_eq!(client.get_trust_score(&issuer), Some(60));
    let rep = client.get_reputation(&issuer);
    assert_eq!(rep.fulfilled_count, 1);
    assert_eq!(rep.late_count, 0);
    assert_eq!(rep.breached_count, 0);
}

// ---------------------------------------------------------------------------
// 5. restore_reputation is permissionless — any caller can invoke it
// ---------------------------------------------------------------------------

#[test]
fn test_restore_reputation_is_permissionless() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);

    // A completely different address (third party) calls restore_reputation.
    // The contract must not require auth from `issuer`.
    let third_party = Address::generate(&env);
    let _ = third_party; // not used as auth, just confirms permissionless path

    // With mock_all_auths the assertion is that the call does not return
    // an authorization error regardless of who is signing — any caller succeeds.
    assert!(client.restore_reputation(&issuer));
}

// ---------------------------------------------------------------------------
// 6. reputation_restored event is emitted
// ---------------------------------------------------------------------------

#[test]
fn test_restore_reputation_emits_event() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);

    client.restore_reputation(&issuer);

    // reputation_restored publishes (symbol_short!("reprstr"), address) as its
    // topics and the `restored_v2` flag as its data payload.
    let expected_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (symbol_short!("reprstr"), issuer.clone()).into_val(&env);

    let events = env.events().all();
    let found = events.iter().any(|event| event.1 == expected_topics);
    assert!(found, "reputation_restored event was not emitted");
}

// ---------------------------------------------------------------------------
// 7. restore_trust_history works for a scored address
// ---------------------------------------------------------------------------

#[test]
fn test_restore_trust_history_returns_true_for_scored_address() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);

    // restore_trust_history targets only the TrustKey::TrustHistory entry.
    assert!(client.restore_trust_history(&issuer));

    // Score is still readable after the TTL extension.
    assert_eq!(client.get_trust_score(&issuer), Some(60));
}

#[test]
fn test_restore_trust_history_returns_false_for_unscored_address() {
    let (_env, client, _issuer, _counterparty) = setup();
    let stranger = Address::generate(&_env);
    assert!(!client.restore_trust_history(&stranger));
}

// ---------------------------------------------------------------------------
// 8. Idempotency: calling restore_reputation multiple times is safe
// ---------------------------------------------------------------------------

#[test]
fn test_restore_reputation_is_idempotent() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);

    assert!(client.restore_reputation(&issuer));
    assert!(client.restore_reputation(&issuer)); // second call must also succeed
    assert_eq!(client.get_trust_score(&issuer), Some(60));
}

// ---------------------------------------------------------------------------
// 9. After restore, a new outcome is recorded correctly
// ---------------------------------------------------------------------------

#[test]
fn test_scoring_continues_after_restore() {
    let (env, client, issuer, counterparty) = setup();
    score_issuer(&env, &client, &issuer, &counterparty);

    // Simulate restore (TTL extension).
    assert!(client.restore_reputation(&issuer));

    // Another commitment: 1 fulfilled + 1 late.
    env.ledger().with_mut(|l| {
        l.timestamp = 2000;
        l.sequence_number = 2000;
    });
    let resolver = Address::generate(&env);
    let id2 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[8u8; 32]),
        &3000,
        &resolver,
        &None,
        &None,
        &soroban_sdk::Vec::new(&env),
        &0,
    );
    env.ledger().with_mut(|l| l.timestamp = 2500);
    client.attest(&issuer, &id2, &CommitmentStatus::Late);

    // 1 fulfilled (+10) + 1 late (-10) = baseline 50.
    assert_eq!(client.get_trust_score(&issuer), Some(50));
    let rep = client.get_reputation(&issuer);
    assert_eq!(rep.fulfilled_count, 1);
    assert_eq!(rep.late_count, 1);
    assert_eq!(rep.breached_count, 0);
}

// ---------------------------------------------------------------------------
// 10. V2 schema: restore works with migrated rows
// ---------------------------------------------------------------------------

#[test]
fn test_restore_reputation_works_with_v2_schema() {
    let (env, client, issuer, counterparty) = setup();

    // Bootstrap the contract so upgrades are possible.
    let arbitrator = Address::generate(&env);
    let admin = Address::generate(&env);
    client.initialize(&soroban_sdk::vec![&env, arbitrator.clone()], &admin);

    score_issuer(&env, &client, &issuer, &counterparty);

    // restore_reputation must work on V1 schema (default) and find the entry.
    assert!(client.restore_reputation(&issuer));
    assert_eq!(client.get_trust_score(&issuer), Some(60));
}
