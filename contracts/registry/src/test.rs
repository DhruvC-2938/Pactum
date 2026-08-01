#![cfg(test)]

use super::*;
use crate::commitments::CommitmentStatus;
use crate::errors::Error;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, BytesN, Env};

fn setup_test() -> (Env, RegistryContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    (env, client, issuer, counterparty)
}

#[test]
fn test_create_and_get_commitment_success() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let commitment_id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);
    assert_eq!(commitment_id, 1);

    let commitment = client.get_commitment(&commitment_id);
    assert_eq!(commitment.id, 1);
    assert_eq!(commitment.issuer, issuer);
    assert_eq!(commitment.counterparty, counterparty);
    assert_eq!(commitment.terms_hash, terms_hash);
    assert_eq!(commitment.due_at, due_at);
    assert_eq!(commitment.status, CommitmentStatus::Pending);
    assert_eq!(commitment.created_at, 1000);
}

#[test]
#[should_panic]
fn test_create_commitment_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let due_at = 2000;

    client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);
}

#[test]
fn test_create_commitment_fails_if_due_at_in_past() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 999;

    let res = client.try_create_commitment(&issuer, &counterparty, &terms_hash, &due_at);
    assert_eq!(res, Err(Ok(Error::DueAtInPast.into())));
}

#[test]
fn test_get_commitment_fails_for_nonexistent_id() {
    let (_env, client, _issuer, _counterparty) = setup_test();

    let res = client.try_get_commitment(&999);
    assert_eq!(res, Err(Ok(Error::CommitmentNotFound.into())));
}

#[test]
fn test_sequential_unique_ids() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let terms_hash2 = BytesN::from_array(&env, &[2u8; 32]);

    let id1 = client.create_commitment(&issuer, &counterparty, &terms_hash1, &2000);
    let id2 = client.create_commitment(&issuer, &counterparty, &terms_hash2, &3000);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_ne!(id1, id2);

    let c1 = client.get_commitment(&id1);
    let c2 = client.get_commitment(&id2);

    assert_eq!(c1.id, 1);
    assert_eq!(c1.terms_hash, terms_hash1);
    assert_eq!(c2.id, 2);
    assert_eq!(c2.terms_hash, terms_hash2);
}

#[test]
fn test_attest_outcome_fulfilled() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);
    assert_eq!(commitment.attested_at, Some(1500));
}

#[test]
fn test_attest_outcome_late_by_counterparty() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    env.ledger().with_mut(|l| l.timestamp = 2500);
    client.attest(&counterparty, &id, &CommitmentStatus::Late);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Late);
    assert_eq!(commitment.attested_at, Some(2500));
}

#[test]
fn test_attest_outcome_breached() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    env.ledger().with_mut(|l| l.timestamp = 2100);
    client.attest(&issuer, &id, &CommitmentStatus::Breached);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Breached);
    assert_eq!(commitment.attested_at, Some(2100));
}

#[test]
fn test_attest_fails_if_not_pending() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    let res = client.try_attest(&issuer, &id, &CommitmentStatus::Late);
    assert_eq!(res, Err(Ok(Error::AlreadyResolved.into())));

    let res2 = client.try_attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res2, Err(Ok(Error::AlreadyResolved.into())));

    let res3 = client.try_attest(&issuer, &id, &CommitmentStatus::Breached);
    assert_eq!(res3, Err(Ok(Error::AlreadyResolved.into())));
}

#[test]
#[should_panic]
fn test_attest_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let due_at = 2000;

    env.mock_all_auths();
    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    env.mock_auths(&[]);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
}

#[test]
fn test_attest_fails_if_unauthorized_caller() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    let stranger = Address::generate(&env);
    let res = client.try_attest(&stranger, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::Unauthorized.into())));
}

#[test]
fn test_attest_fails_for_pending_outcome() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    let res = client.try_attest(&issuer, &id, &CommitmentStatus::Pending);
    assert_eq!(res, Err(Ok(Error::InvalidOutcome.into())));
}

#[test]
fn test_is_overdue_before_and_after_due_date() {
    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    assert_eq!(client.is_overdue(&id), false);

    env.ledger().with_mut(|l| l.timestamp = 2000);
    assert_eq!(client.is_overdue(&id), false);

    env.ledger().with_mut(|l| l.timestamp = 2001);
    assert_eq!(client.is_overdue(&id), true);

    client.attest(&issuer, &id, &CommitmentStatus::Late);
    assert_eq!(client.is_overdue(&id), false);
}

#[test]
fn test_is_overdue_fails_for_nonexistent_id() {
    let (_env, client, _issuer, _counterparty) = setup_test();
    let res = client.try_is_overdue(&999);
    assert_eq!(res, Err(Ok(Error::CommitmentNotFound.into())));
}

#[test]
fn test_events_emitted() {
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{symbol_short, FromVal, IntoVal, Val, Vec};

    let (env, client, issuer, counterparty) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at);

    let create_events = env.events().all();
    assert_eq!(create_events.len(), 1);
    let created_event = create_events.get(0).unwrap();
    let expected_created_topics: Vec<Val> = (
        symbol_short!("created"),
        issuer.clone(),
        counterparty.clone(),
    )
        .into_val(&env);
    assert_eq!(created_event.0, client.address);
    assert_eq!(created_event.1, expected_created_topics);
    assert_eq!(u64::from_val(&env, &created_event.2), 1u64);

    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    let attest_events = env.events().all();
    assert_eq!(attest_events.len(), 1);
    let attested_event = attest_events.get(0).unwrap();
    let expected_attested_topics: Vec<Val> =
        (symbol_short!("attested"), 1u64).into_val(&env);
    assert_eq!(attested_event.0, client.address);
    assert_eq!(attested_event.1, expected_attested_topics);
    assert_eq!(
        CommitmentStatus::from_val(&env, &attested_event.2),
        CommitmentStatus::Fulfilled
    );
}
