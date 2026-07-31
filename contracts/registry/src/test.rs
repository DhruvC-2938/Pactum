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
