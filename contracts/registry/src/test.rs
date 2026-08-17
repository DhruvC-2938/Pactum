#![cfg(test)]

use super::*;
use crate::commitments::CommitmentStatus;
use crate::errors::Error;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, BytesN, Env};

fn setup_test() -> (
    Env,
    RegistryContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let resolver = Address::generate(&env);
    (env, client, issuer, counterparty, resolver)
}

#[test]
fn test_create_and_get_commitment_success() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let commitment_id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    assert_eq!(commitment_id, 1);

    let commitment = client.get_commitment(&commitment_id);
    assert_eq!(commitment.id, 1);
    assert_eq!(commitment.issuer, issuer);
    assert_eq!(commitment.counterparty, counterparty);
    assert_eq!(commitment.terms_hash, terms_hash);
    assert_eq!(commitment.due_at, due_at);
    assert_eq!(commitment.status, CommitmentStatus::Pending);
    assert_eq!(commitment.created_at, 1000);
    assert_eq!(commitment.resolver_address, resolver);
}

#[test]
#[should_panic]
fn test_create_commitment_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let resolver = Address::generate(&env);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let due_at = 2000;

    client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
}

#[test]
fn test_create_commitment_fails_if_due_at_in_past() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 999;

    let res = client.try_create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    assert_eq!(res, Err(Ok(Error::DueAtInPast.into())));
}

#[test]
fn test_get_commitment_fails_for_nonexistent_id() {
    let (_env, client, _issuer, _counterparty, _resolver) = setup_test();

    let res = client.try_get_commitment(&999);
    assert_eq!(res, Err(Ok(Error::CommitmentNotFound.into())));
}

#[test]
fn test_sequential_unique_ids() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let terms_hash2 = BytesN::from_array(&env, &[2u8; 32]);

    let id1 = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash1,
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    let id2 = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash2,
        &3000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

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
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);
    assert_eq!(commitment.attested_at, Some(1500));
}

#[test]
fn test_attest_outcome_late_by_counterparty() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 2500);
    client.attest(&counterparty, &id, &CommitmentStatus::Late);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Late);
    assert_eq!(commitment.attested_at, Some(2500));
}

#[test]
fn test_attest_outcome_breached() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 2100);
    client.attest(&issuer, &id, &CommitmentStatus::Breached);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Breached);
    assert_eq!(commitment.attested_at, Some(2100));
}

#[test]
fn test_attest_fails_if_not_pending() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

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
    let resolver = Address::generate(&env);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let due_at = 2000;

    env.mock_all_auths();
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.mock_auths(&[]);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
}

#[test]
fn test_attest_fails_if_unauthorized_caller() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    let stranger = Address::generate(&env);
    let res = client.try_attest(&stranger, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::Unauthorized.into())));
}

#[test]
fn test_attest_fails_for_pending_outcome() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    let res = client.try_attest(&issuer, &id, &CommitmentStatus::Pending);
    assert_eq!(res, Err(Ok(Error::InvalidOutcome.into())));
}

#[test]
fn test_is_overdue_before_and_after_due_date() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    assert!(!client.is_overdue(&id));

    env.ledger().with_mut(|l| l.timestamp = 2000);
    assert!(!client.is_overdue(&id));

    env.ledger().with_mut(|l| l.timestamp = 2001);
    assert!(client.is_overdue(&id));

    client.attest(&issuer, &id, &CommitmentStatus::Late);
    assert!(!client.is_overdue(&id));
}

#[test]
fn test_is_overdue_fails_for_nonexistent_id() {
    let (_env, client, _issuer, _counterparty, _resolver) = setup_test();
    let res = client.try_is_overdue(&999);
    assert_eq!(res, Err(Ok(Error::CommitmentNotFound.into())));
}

#[test]
fn test_events_emitted() {
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{symbol_short, FromVal, IntoVal, Val, Vec};

    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

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
    let expected_attested_topics: Vec<Val> = (symbol_short!("attested"), 1u64).into_val(&env);
    assert_eq!(attested_event.0, client.address);
    assert_eq!(attested_event.1, expected_attested_topics);
    assert_eq!(
        CommitmentStatus::from_val(&env, &attested_event.2),
        CommitmentStatus::Fulfilled
    );
}

fn setup_test_with_arbitrator() -> (
    Env,
    RegistryContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let (env, client, issuer, counterparty, resolver) = setup_test();
    let arbitrator = Address::generate(&env);
    client.initialize(&soroban_sdk::vec![&env, arbitrator]);
    (env, client, issuer, counterparty, resolver)
}

/// Initializes the contract with a committee of `count` fresh arbitrators and
/// returns the committee alongside the usual test fixtures.
fn setup_test_with_arbitrators(
    count: u32,
) -> (
    Env,
    RegistryContractClient<'static>,
    soroban_sdk::Vec<Address>,
    Address,
    Address,
    Address,
) {
    let (env, client, issuer, counterparty, resolver) = setup_test();
    let mut arbitrators = soroban_sdk::Vec::new(&env);
    for _ in 0..count {
        arbitrators.push_back(Address::generate(&env));
    }
    client.initialize(&arbitrators);
    (env, client, arbitrators, issuer, counterparty, resolver)
}

#[test]
fn test_initialize_can_only_run_once() {
    let (env, client, _issuer, _counterparty, _resolver) = setup_test_with_arbitrator();
    let arbitrator = client.get_arbitrator();
    let res = client.try_initialize(&soroban_sdk::vec![&env, arbitrator.clone()]);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized.into())));
    assert_eq!(client.get_arbitrator(), arbitrator);
}

#[test]
fn test_initialize_rejects_an_empty_arbitrator_set() {
    let (env, client, _issuer, _counterparty, _resolver) = setup_test();
    let res = client.try_initialize(&soroban_sdk::Vec::new(&env));
    assert_eq!(res, Err(Ok(Error::EmptyArbitratorSet.into())));
}

#[test]
fn test_initialize_stores_and_deduplicates_the_arbitrator_set() {
    let (env, client, _issuer, _counterparty, _resolver) = setup_test();

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let mut input = soroban_sdk::Vec::new(&env);
    input.push_back(a.clone());
    input.push_back(b.clone());
    input.push_back(a.clone()); // duplicate: must be dropped
    input.push_back(c.clone());

    client.initialize(&input);

    let expected = soroban_sdk::vec![&env, a.clone(), b.clone(), c.clone()];
    assert_eq!(client.get_arbitrators(), expected);
    // Backwards-compatible accessor returns the first member.
    assert_eq!(client.get_arbitrator(), a);
}

#[test]
fn test_get_arbitrators_fails_if_uninitialized() {
    let (_env, client, _issuer, _counterparty, _resolver) = setup_test();
    let res = client.try_get_arbitrators();
    assert_eq!(res, Err(Ok(Error::NotInitialized.into())));
}

#[test]
fn test_dispute_and_resolution_end_to_end() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);

    // Either party can dispute within the window
    env.ledger().with_mut(|l| l.timestamp = 1600);
    client.dispute(&counterparty, &id);

    let disputed_comm = client.get_commitment(&id);
    assert_eq!(disputed_comm.status, CommitmentStatus::Disputed);

    // Custom resolver resolves the dispute
    env.ledger().with_mut(|l| l.timestamp = 1700);
    client.resolve_dispute(&resolver, &id, &CommitmentStatus::Breached);

    let resolved_comm = client.get_commitment(&id);
    assert_eq!(resolved_comm.status, CommitmentStatus::Breached);
}

#[test]
fn test_dispute_fails_outside_dispute_window() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    // Advance timestamp beyond the dispute window (1500 + 604_800 = 606_300)
    env.ledger()
        .with_mut(|l| l.timestamp = 1500 + DISPUTE_WINDOW_SECONDS + 1);
    let res = client.try_dispute(&counterparty, &id);
    assert_eq!(res, Err(Ok(Error::DisputeWindowExpired.into())));
}

#[test]
fn test_dispute_succeeds_at_window_boundary() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    // Exactly at the boundary is allowed
    env.ledger()
        .with_mut(|l| l.timestamp = 1500 + DISPUTE_WINDOW_SECONDS);
    client.dispute(&counterparty, &id);
    let comm = client.get_commitment(&id);
    assert_eq!(comm.status, CommitmentStatus::Disputed);
}

#[test]
fn test_dispute_fails_if_caller_not_issuer_or_counterparty() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    let stranger = Address::generate(&env);
    let res = client.try_dispute(&stranger, &id);
    assert_eq!(res, Err(Ok(Error::Unauthorized.into())));
}
#[test]
fn test_resolve_dispute_fails_if_caller_not_arbitrator() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&counterparty, &id);

    let stranger = Address::generate(&env);
    let res = client.try_resolve_dispute(&stranger, &id, &CommitmentStatus::Breached);
    assert_eq!(res, Err(Ok(Error::NotArbitrator.into())));

    let res2 = client.try_resolve_dispute(&issuer, &id, &CommitmentStatus::Breached);
    assert_eq!(res2, Err(Ok(Error::NotArbitrator.into())));

    // Global contract arbitrator is also rejected when not the designated resolver
    let global_arbitrator = client.get_arbitrator();
    let res3 = client.try_resolve_dispute(&global_arbitrator, &id, &CommitmentStatus::Breached);
    assert_eq!(res3, Err(Ok(Error::NotArbitrator.into())));
}

#[test]
fn test_resolve_dispute_fails_if_commitment_not_disputed() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    // Pending -> resolve_dispute should fail
    let res = client.try_resolve_dispute(&resolver, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::InvalidTransition.into())));

    // Fulfilled -> resolve_dispute should fail
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    let res2 = client.try_resolve_dispute(&resolver, &id, &CommitmentStatus::Late);
    assert_eq!(res2, Err(Ok(Error::InvalidTransition.into())));
}

#[test]
fn test_resolve_dispute_rejects_invalid_final_outcome() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&counterparty, &id);

    // Reject Pending
    let res1 = client.try_resolve_dispute(&resolver, &id, &CommitmentStatus::Pending);
    assert_eq!(res1, Err(Ok(Error::InvalidOutcome.into())));

    // Reject Disputed
    let res2 = client.try_resolve_dispute(&resolver, &id, &CommitmentStatus::Disputed);
    assert_eq!(res2, Err(Ok(Error::InvalidOutcome.into())));
}

// -----------------------------------------------------------------------------
// Multi-arbitrator majority-vote resolution (issue #11)
// -----------------------------------------------------------------------------

/// Creates an attested, disputed commitment whose resolver is `resolver`.
fn setup_disputed_commitment(
    env: &Env,
    client: &RegistryContractClient<'static>,
    issuer: &Address,
    counterparty: &Address,
    resolver: &Address,
) -> u64 {
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        issuer,
        counterparty,
        &BytesN::from_array(env, &[1u8; 32]),
        &2000,
        resolver,
    );
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(issuer, &id, &CommitmentStatus::Fulfilled);
    env.ledger().with_mut(|l| l.timestamp = 1600);
    client.dispute(counterparty, &id);
    id
}

#[test]
fn test_resolve_dispute_requires_a_majority_vote() {
    let (env, client, arbitrators, issuer, counterparty, _resolver) =
        setup_test_with_arbitrators(3);
    let arb0 = arbitrators.get(0).unwrap();
    let arb1 = arbitrators.get(1).unwrap();
    let arb2 = arbitrators.get(2).unwrap();

    // Naming an arbitrator as the resolver routes the dispute to the committee.
    let id = setup_disputed_commitment(&env, &client, &issuer, &counterparty, &arb0);

    // A single vote is not a majority of three (need > 3/2 = 1).
    client.resolve_dispute(&arb0, &id, &CommitmentStatus::Breached);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Disputed);

    // A second, agreeing arbitrator reaches the majority and finalizes.
    client.resolve_dispute(&arb1, &id, &CommitmentStatus::Breached);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Breached);
    assert_eq!(commitment.attested_at, None);

    // Reputation is applied exactly once, with the final majority outcome.
    let rep = client.get_reputation(&issuer);
    assert_eq!(rep.breached_count, 1);
    assert_eq!(rep.fulfilled_count, 0);

    // Once resolved, no further votes are accepted.
    let res = client.try_resolve_dispute(&arb2, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::InvalidTransition.into())));
}

#[test]
fn test_resolve_dispute_majority_wins_over_dissent() {
    let (env, client, arbitrators, issuer, counterparty, _resolver) =
        setup_test_with_arbitrators(3);
    let arb0 = arbitrators.get(0).unwrap();
    let arb1 = arbitrators.get(1).unwrap();
    let arb2 = arbitrators.get(2).unwrap();

    let id = setup_disputed_commitment(&env, &client, &issuer, &counterparty, &arb0);

    // One arbitrator votes Fulfilled, the other two vote Breached: Breached wins.
    client.resolve_dispute(&arb0, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(client.get_commitment(&id).status, CommitmentStatus::Disputed);

    client.resolve_dispute(&arb1, &id, &CommitmentStatus::Breached);
    assert_eq!(client.get_commitment(&id).status, CommitmentStatus::Disputed);

    client.resolve_dispute(&arb2, &id, &CommitmentStatus::Breached);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Breached);

    let rep = client.get_reputation(&issuer);
    assert_eq!(rep.breached_count, 1);
    assert_eq!(rep.fulfilled_count, 0);
}

#[test]
fn test_resolve_dispute_arbitrator_cannot_vote_twice() {
    let (env, client, arbitrators, issuer, counterparty, _resolver) =
        setup_test_with_arbitrators(3);
    let arb0 = arbitrators.get(0).unwrap();

    let id = setup_disputed_commitment(&env, &client, &issuer, &counterparty, &arb0);

    client.resolve_dispute(&arb0, &id, &CommitmentStatus::Breached);

    // The same arbitrator casting a second vote is rejected.
    let res = client.try_resolve_dispute(&arb0, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::AlreadyVoted.into())));

    // The dispute is still open for the other arbitrators.
    assert_eq!(client.get_commitment(&id).status, CommitmentStatus::Disputed);
}

#[test]
fn test_resolve_dispute_half_the_committee_is_not_enough() {
    let (env, client, arbitrators, issuer, counterparty, _resolver) =
        setup_test_with_arbitrators(2);
    let arb0 = arbitrators.get(0).unwrap();
    let arb1 = arbitrators.get(1).unwrap();

    let id = setup_disputed_commitment(&env, &client, &issuer, &counterparty, &arb0);

    // With two arbitrators, one vote is exactly half — not a majority.
    client.resolve_dispute(&arb0, &id, &CommitmentStatus::Late);
    assert_eq!(client.get_commitment(&id).status, CommitmentStatus::Disputed);

    // The second (and last) vote reaches unanimity and finalizes.
    client.resolve_dispute(&arb1, &id, &CommitmentStatus::Late);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Late);
    assert_eq!(client.get_reputation(&issuer).late_count, 1);
}

#[test]
fn test_resolve_dispute_single_arbitrator_finalizes_on_first_vote() {
    let (env, client, arbitrators, issuer, counterparty, _resolver) =
        setup_test_with_arbitrators(1);
    let arb0 = arbitrators.get(0).unwrap();

    let id = setup_disputed_commitment(&env, &client, &issuer, &counterparty, &arb0);

    // One arbitrator: the first vote already exceeds half (1 > 0).
    client.resolve_dispute(&arb0, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(
        client.get_commitment(&id).status,
        CommitmentStatus::Fulfilled
    );
}

#[test]
fn test_resolve_dispute_committee_cannot_vote_on_custom_resolver_commitment() {
    let (env, client, arbitrators, issuer, counterparty, _resolver) =
        setup_test_with_arbitrators(3);
    let arb0 = arbitrators.get(0).unwrap();

    // A custom resolver outside the committee keeps full control of its dispute.
    let custom_resolver = Address::generate(&env);
    let id = setup_disputed_commitment(&env, &client, &issuer, &counterparty, &custom_resolver);

    // No committee member may vote on it.
    let res = client.try_resolve_dispute(&arb0, &id, &CommitmentStatus::Breached);
    assert_eq!(res, Err(Ok(Error::NotArbitrator.into())));

    // The designated custom resolver still resolves it directly.
    client.resolve_dispute(&custom_resolver, &id, &CommitmentStatus::Breached);
    assert_eq!(
        client.get_commitment(&id).status,
        CommitmentStatus::Breached
    );
}

#[test]
fn test_dispute_fails_if_pending() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    let res = client.try_dispute(&issuer, &id);
    assert_eq!(res, Err(Ok(Error::InvalidTransition.into())));
}

#[test]
fn test_dispute_fails_if_already_disputed() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&counterparty, &id);

    // Try disputing again while Disputed
    let res = client.try_dispute(&counterparty, &id);
    assert_eq!(res, Err(Ok(Error::InvalidTransition.into())));
}

#[test]
fn test_attest_fails_for_disputed_outcome() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    let res = client.try_attest(&issuer, &id, &CommitmentStatus::Disputed);
    assert_eq!(res, Err(Ok(Error::InvalidOutcome.into())));
}

#[test]
fn test_dispute_events_emitted() {
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{symbol_short, FromVal, IntoVal, Val, Vec};

    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 2000;

    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    client.dispute(&counterparty, &id);

    let all_events = env.events().all();
    let disputed_event = all_events.get(all_events.len() - 1).unwrap();
    let expected_disputed_topics: Vec<Val> = (symbol_short!("disputed"), 1u64).into_val(&env);
    assert_eq!(disputed_event.0, client.address);
    assert_eq!(disputed_event.1, expected_disputed_topics);
    assert_eq!(<()>::from_val(&env, &disputed_event.2), ());

    client.resolve_dispute(&resolver, &id, &CommitmentStatus::Late);

    let all_events_after = env.events().all();
    let resolved_event = all_events_after.get(all_events_after.len() - 1).unwrap();
    let expected_resolved_topics: Vec<Val> = (symbol_short!("resolved"), 1u64).into_val(&env);
    assert_eq!(resolved_event.0, client.address);
    assert_eq!(resolved_event.1, expected_resolved_topics);
    assert_eq!(
        CommitmentStatus::from_val(&env, &resolved_event.2),
        CommitmentStatus::Late
    );
}

#[test]
#[should_panic]
fn test_dispute_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let resolver = Address::generate(&env);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    env.mock_all_auths();
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    env.mock_auths(&[]);
    client.dispute(&counterparty, &id);
}

#[test]
#[should_panic]
fn test_resolve_dispute_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let resolver = Address::generate(&env);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    env.mock_all_auths();
    client.initialize(&soroban_sdk::vec![&env, arbitrator]);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&counterparty, &id);

    env.mock_auths(&[]);
    client.resolve_dispute(&resolver, &id, &CommitmentStatus::Late);
}

#[test]
#[should_panic]
fn test_initialize_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let arbitrator = Address::generate(&env);

    client.initialize(&soroban_sdk::vec![&env, arbitrator]);
}

// -----------------------------------------------------------------------------
// Phase 4 - Reputation Tests
// -----------------------------------------------------------------------------

#[test]
fn test_get_reputation_zeroed_for_new_address() {
    let (_env, client, _issuer, _counterparty, _resolver) = setup_test();
    let new_issuer = Address::generate(&_env);

    let rep = client.get_reputation(&new_issuer);
    assert_eq!(rep.fulfilled_count, 0);
    assert_eq!(rep.late_count, 0);
    assert_eq!(rep.breached_count, 0);
}

#[test]
fn test_reputation_increments_direct_attestation() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let due_at = 2000;

    // Create and fulfill first commitment
    let id1 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id1, &CommitmentStatus::Fulfilled);

    let rep1 = client.get_reputation(&issuer);
    assert_eq!(rep1.fulfilled_count, 1);
    assert_eq!(rep1.late_count, 0);
    assert_eq!(rep1.breached_count, 0);

    // Create and late second commitment
    let id2 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[2u8; 32]),
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id2, &CommitmentStatus::Late);

    let rep2 = client.get_reputation(&issuer);
    assert_eq!(rep2.fulfilled_count, 1);
    assert_eq!(rep2.late_count, 1);
    assert_eq!(rep2.breached_count, 0);

    // Create and breach third commitment
    let id3 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[3u8; 32]),
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id3, &CommitmentStatus::Breached);

    let rep3 = client.get_reputation(&issuer);
    assert_eq!(rep3.fulfilled_count, 1);
    assert_eq!(rep3.late_count, 1);
    assert_eq!(rep3.breached_count, 1);
}

#[test]
fn test_reputation_not_incremented_when_disputed() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    // Initial attestation increments it
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    let rep_before = client.get_reputation(&issuer);
    assert_eq!(rep_before.fulfilled_count, 1);

    // Dispute decrements it back to 0
    client.dispute(&counterparty, &id);
    let rep_after = client.get_reputation(&issuer);
    assert_eq!(rep_after.fulfilled_count, 0);
    assert_eq!(rep_after.late_count, 0);
    assert_eq!(rep_after.breached_count, 0);
}

#[test]
fn test_reputation_reflects_final_outcome_after_dispute() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    // 1. Attest as Breached
    client.attest(&issuer, &id, &CommitmentStatus::Breached);
    let rep1 = client.get_reputation(&issuer);
    assert_eq!(rep1.breached_count, 1);

    // 2. Dispute
    client.dispute(&counterparty, &id);
    let rep2 = client.get_reputation(&issuer);
    assert_eq!(rep2.breached_count, 0); // Decr old outcome

    // 3. Resolve as Fulfilled
    client.resolve_dispute(&resolver, &id, &CommitmentStatus::Fulfilled);
    let rep3 = client.get_reputation(&issuer);

    // Most important check: ONLY final outcome is counted
    assert_eq!(rep3.fulfilled_count, 1);
    assert_eq!(rep3.breached_count, 0);
    assert_eq!(rep3.late_count, 0);
}

#[test]
fn test_reputation_aggregates_multiple_commitments() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Comm 1: Fulfilled (direct)
    let id1 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id1, &CommitmentStatus::Fulfilled);

    // Comm 2: Late (disputed, resolved as Late)
    let id2 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[2u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id2, &CommitmentStatus::Fulfilled); // Attested as Fulfilled initially
    client.dispute(&counterparty, &id2);
    client.resolve_dispute(&resolver, &id2, &CommitmentStatus::Late); // Overturned to Late

    // Comm 3: Breached (direct)
    let id3 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[3u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id3, &CommitmentStatus::Breached);

    // Comm 4: Fulfilled (direct)
    let id4 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[4u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id4, &CommitmentStatus::Fulfilled);

    let rep = client.get_reputation(&issuer);
    assert_eq!(rep.fulfilled_count, 2); // Comm 1, Comm 4
    assert_eq!(rep.late_count, 1); // Comm 2
    assert_eq!(rep.breached_count, 1); // Comm 3
}

// -----------------------------------------------------------------------------
// Phase 5 - Hardening & Edge Cases
// -----------------------------------------------------------------------------

#[test]
fn test_create_commitment_fails_if_due_at_is_current_timestamp() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_at = 1000; // Exactly current timestamp

    let res = client.try_create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    assert_eq!(res, Err(Ok(Error::DueAtInPast.into())));
}

#[test]
fn test_dispute_fails_if_already_resolved() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    // Attest, dispute, resolve
    client.attest(&issuer, &id, &CommitmentStatus::Late);
    client.dispute(&counterparty, &id);
    client.resolve_dispute(&resolver, &id, &CommitmentStatus::Fulfilled);

    // Try disputing again after final resolution
    let res = client.try_dispute(&counterparty, &id);
    assert_eq!(res, Err(Ok(Error::InvalidTransition.into())));
}

#[test]
fn test_realistic_sequence() {
    // create -> attest late -> dispute -> resolve fulfilled -> verify reputation
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    env.ledger().with_mut(|l| l.timestamp = 2500); // Late
    client.attest(&issuer, &id, &CommitmentStatus::Late);

    let rep_after_attest = client.get_reputation(&issuer);
    assert_eq!(rep_after_attest.late_count, 1);

    client.dispute(&counterparty, &id);
    let rep_after_dispute = client.get_reputation(&issuer);
    assert_eq!(rep_after_dispute.late_count, 0); // Decremented

    client.resolve_dispute(&resolver, &id, &CommitmentStatus::Fulfilled);

    let rep_final = client.get_reputation(&issuer);
    assert_eq!(rep_final.fulfilled_count, 1);
    assert_eq!(rep_final.late_count, 0);
    assert_eq!(rep_final.breached_count, 0);

    let comm = client.get_commitment(&id);
    assert_eq!(comm.status, CommitmentStatus::Fulfilled);
}

// -----------------------------------------------------------------------------
// TrustGate Phase B - Reentrancy Hardening
// -----------------------------------------------------------------------------

#[test]
fn test_reentrancy_attack_during_resolve_dispute_is_blocked() {
    use crate::attacker_gate::{AttackerGate, AttackerGateClient};
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let (env, client, issuer, counterparty, _resolver) = setup_test();

    // Register the malicious mock as a real contract (not via mock_auths,
    // which would silently replace it with a no-op stand-in) so that its
    // __check_auth implementation is genuinely invoked.
    let attacker_id = env.register(AttackerGate, ());
    let attacker_client = AttackerGateClient::new(&env, &attacker_id);

    client.initialize(&soroban_sdk::vec![&env, attacker_id.clone()]);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[7u8; 32]),
        &2000,
        &attacker_id,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&counterparty, &id);

    attacker_client.init(&client.address, &id);

    // Disable auth mocking and supply a real Address-credentialed auth entry
    // for the attacker, so the host actually invokes AttackerGate's
    // __check_auth instead of bypassing it (mocked auths never invoke a
    // custom account's __check_auth).
    env.set_auths(&[(&MockAuth {
        address: &attacker_id,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "resolve_dispute",
            args: (attacker_id.clone(), id, CommitmentStatus::Fulfilled).into_val(&env),
            sub_invokes: &[],
        },
    })
        .into()]);

    // Legitimate resolution by the arbitrator. Mid-flight, inside
    // __check_auth, AttackerGate attempts to re-enter resolve_dispute for
    // the same commitment to double-process it before the first call has
    // applied its state changes.
    client.resolve_dispute(&attacker_id, &id, &CommitmentStatus::Fulfilled);

    // The reentrant call must have been rejected by the reentrancy guard.
    assert!(
        attacker_client.reentry_was_blocked(),
        "diag_code={}",
        attacker_client.diag_code()
    );

    // The legitimate call must have completed exactly once, with correct
    // final state and no double-counted reputation.
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);

    let rep = client.get_reputation(&issuer);
    assert_eq!(rep.fulfilled_count, 1);
    assert_eq!(rep.late_count, 0);
    assert_eq!(rep.breached_count, 0);
}

#[test]
fn test_reentrant_attest_call_is_rejected() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    // Simulate a stuck guard (as if a nested call were already in progress)
    // and verify a top-level mutating call is rejected while it is locked.
    env.as_contract(&client.address, || {
        crate::reentrancy::enter(&env);
    });

    let res = client.try_attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::ReentrantCall.into())));

    env.as_contract(&client.address, || {
        crate::reentrancy::exit(&env);
    });

    // Once released, the call succeeds normally.
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);
}

#[test]
fn test_get_trust_score_reflects_outcomes() {
    let (env, client, issuer, counterparty, resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);

    assert_eq!(client.get_trust_score(&issuer), 50);

    let id1 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[1u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id1, &CommitmentStatus::Fulfilled);
    assert_eq!(client.get_trust_score(&issuer), 60);

    let id2 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[2u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id2, &CommitmentStatus::Late);
    assert_eq!(client.get_trust_score(&issuer), 50);

    let id3 = client.create_commitment(
        &issuer,
        &counterparty,
        &BytesN::from_array(&env, &[3u8; 32]),
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );
    client.attest(&issuer, &id3, &CommitmentStatus::Breached);
    assert_eq!(client.get_trust_score(&issuer), 0);
}

#[test]
fn test_custom_resolver_delegation() {
    let (env, client, issuer, counterparty, _default_resolver) = setup_test_with_arbitrator();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[9u8; 32]);
    let due_at = 2000;

    // Designate a custom resolver address
    let custom_resolver = Address::generate(&env);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &custom_resolver,
        &Vec::new(&env),
        &0,
    );

    let comm = client.get_commitment(&id);
    assert_eq!(comm.resolver_address, custom_resolver);

    // Attest and dispute
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&counterparty, &id);

    // Global arbitrator cannot resolve when a custom resolver is assigned
    let global_arbitrator = client.get_arbitrator();
    let res_arb = client.try_resolve_dispute(&global_arbitrator, &id, &CommitmentStatus::Breached);
    assert_eq!(res_arb, Err(Ok(Error::NotArbitrator.into())));

    // Custom resolver successfully resolves
    client.resolve_dispute(&custom_resolver, &id, &CommitmentStatus::Breached);
    let resolved = client.get_commitment(&id);
    assert_eq!(resolved.status, CommitmentStatus::Breached);
}

#[test]
fn test_legacy_commitment_storage_migration() {
    let (env, client, issuer, counterparty, _default_resolver) = setup_test_with_arbitrator();

    // Directly seed a LegacyCommitment in persistent storage (simulating pre-upgrade storage)
    let arbitrator = client.get_arbitrator();
    let legacy_id = 99u64;
    let legacy_comm = commitments::LegacyCommitment {
        id: legacy_id,
        issuer: issuer.clone(),
        counterparty: counterparty.clone(),
        terms_hash: BytesN::from_array(&env, &[5u8; 32]),
        due_at: 2000,
        status: CommitmentStatus::Fulfilled,
        created_at: 1000,
        attested_at: Some(1500),
    };

    env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .set(&commitments::DataKey::Commitment(legacy_id), &legacy_comm);
    });

    // Reading via get_commitment migrates the legacy record and assigns fallback arbitrator as resolver
    let migrated = client.get_commitment(&legacy_id);
    assert_eq!(migrated.id, legacy_id);
    assert_eq!(migrated.resolver_address, arbitrator);
    assert_eq!(migrated.status, CommitmentStatus::Fulfilled);

    // Raising a dispute on the migrated commitment works and resolves with the fallback arbitrator
    env.ledger().with_mut(|l| l.timestamp = 1600);
    client.dispute(&counterparty, &legacy_id);
    client.resolve_dispute(&arbitrator, &legacy_id, &CommitmentStatus::Breached);

    let final_comm = client.get_commitment(&legacy_id);
    assert_eq!(final_comm.status, CommitmentStatus::Breached);
}

#[test]
fn test_legacy_commitment_migration_fails_if_uninitialized() {
    // Set up uninitialized contract
    let (env, client, issuer, counterparty, _resolver) = setup_test();

    let legacy_id = 101u64;
    let legacy_comm = commitments::LegacyCommitment {
        id: legacy_id,
        issuer: issuer.clone(),
        counterparty: counterparty.clone(),
        terms_hash: BytesN::from_array(&env, &[7u8; 32]),
        due_at: 2000,
        status: CommitmentStatus::Fulfilled,
        created_at: 1000,
        attested_at: Some(1500),
    };

    env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .set(&commitments::DataKey::Commitment(legacy_id), &legacy_comm);
    });

    // Reading legacy commitment without an initialized arbitrator fails with NotInitialized
    let res = client.try_get_commitment(&legacy_id);
    assert_eq!(res, Err(Ok(Error::NotInitialized.into())));
}

#[test]
fn test_legacy_commitment_migration_fails_if_payload_id_mismatch() {
    let (env, client, issuer, counterparty, _resolver) = setup_test_with_arbitrator();

    let storage_key_id = 200u64;
    let payload_id = 999u64; // Inconsistent with storage key
    let legacy_comm = commitments::LegacyCommitment {
        id: payload_id,
        issuer: issuer.clone(),
        counterparty: counterparty.clone(),
        terms_hash: BytesN::from_array(&env, &[8u8; 32]),
        due_at: 2000,
        status: CommitmentStatus::Pending,
        created_at: 1000,
        attested_at: None,
    };

    env.as_contract(&client.address, || {
        env.storage().persistent().set(
            &commitments::DataKey::Commitment(storage_key_id),
            &legacy_comm,
        );
    });

    let res = client.try_get_commitment(&storage_key_id);
    assert_eq!(res, Err(Ok(Error::CommitmentNotFound.into())));
}

fn setup_milestone_commitment(
    milestone_count: u32,
) -> (Env, RegistryContractClient<'static>, Address, Address, u64) {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[7u8; 32]);
    let id = client.create_milestone_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &milestone_count,
        &Vec::new(&env),
        &0,
    );

    (env, client, issuer, counterparty, id)
}

#[test]
fn test_create_commitment_defaults_to_a_single_milestone() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.milestone_count, 1);
    assert_eq!(commitment.milestones_attested, 0);
    assert_eq!(commitment.late_milestones, 0);
}

#[test]
fn test_create_milestone_commitment_initializes_counters() {
    let (_env, client, _issuer, _counterparty, id) = setup_milestone_commitment(4);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.milestone_count, 4);
    assert_eq!(commitment.milestones_attested, 0);
    assert_eq!(commitment.late_milestones, 0);
    assert_eq!(commitment.status, CommitmentStatus::Pending);
}

#[test]
fn test_create_milestone_commitment_rejects_zero_milestones() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);

    let res = client.try_create_milestone_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &0,
        &Vec::new(&env),
        &0,
    );
    assert_eq!(res, Err(Ok(Error::InvalidMilestoneCount.into())));
}

#[test]
fn test_create_milestone_commitment_rejects_more_than_max_milestones() {
    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let too_many = crate::commitments::MAX_MILESTONES + 1;

    let res = client.try_create_milestone_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &too_many,
        &Vec::new(&env),
        &0,
    );
    assert_eq!(res, Err(Ok(Error::InvalidMilestoneCount.into())));
}

#[test]
fn test_commitment_stays_pending_until_the_final_milestone() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(3);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Pending);
    assert_eq!(commitment.milestones_attested, 1);
    assert_eq!(commitment.attested_at, None);

    client.attest_milestone(&issuer, &id, &1, &CommitmentStatus::Fulfilled);
    assert_eq!(client.get_commitment(&id).status, CommitmentStatus::Pending);

    client.attest_milestone(&issuer, &id, &2, &CommitmentStatus::Fulfilled);
    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);
    assert_eq!(commitment.milestones_attested, 3);
    assert_eq!(commitment.attested_at, Some(1000));
}

#[test]
fn test_commitment_resolves_late_when_any_milestone_is_late() {
    let (_env, client, issuer, counterparty, id) = setup_milestone_commitment(3);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
    client.attest_milestone(&counterparty, &id, &1, &CommitmentStatus::Late);
    client.attest_milestone(&issuer, &id, &2, &CommitmentStatus::Fulfilled);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Late);
    assert_eq!(commitment.late_milestones, 1);
    assert_eq!(client.get_reputation(&issuer).late_count, 1);
    assert_eq!(client.get_reputation(&issuer).fulfilled_count, 0);
}

#[test]
fn test_breached_milestone_resolves_the_commitment_immediately() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(4);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
    client.attest_milestone(&issuer, &id, &1, &CommitmentStatus::Breached);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Breached);
    assert_eq!(commitment.milestones_attested, 2);
    assert_eq!(commitment.attested_at, Some(1000));
    assert_eq!(client.get_reputation(&issuer).breached_count, 1);

    let res = client.try_attest_milestone(&issuer, &id, &2, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::AlreadyResolved.into())));
}

#[test]
fn test_attest_walks_milestones_in_order_without_an_index() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(3);

    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(client.get_commitment(&id).status, CommitmentStatus::Pending);

    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(
        client.get_commitment(&id).status,
        CommitmentStatus::Fulfilled
    );
}

#[test]
fn test_attest_milestone_rejects_an_out_of_range_index() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(2);

    let res = client.try_attest_milestone(&issuer, &id, &2, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::InvalidMilestoneIndex.into())));
}

#[test]
fn test_attest_milestone_rejects_an_already_attested_index() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(3);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);

    let res = client.try_attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::MilestoneAlreadyAttested.into())));
}

#[test]
fn test_attest_milestone_rejects_an_out_of_order_index() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(3);

    let res = client.try_attest_milestone(&issuer, &id, &1, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::MilestoneOutOfOrder.into())));
}

#[test]
fn test_attest_milestone_rejects_an_unauthorized_caller() {
    let (env, client, _issuer, _counterparty, id) = setup_milestone_commitment(2);

    let stranger = Address::generate(&env);
    let res = client.try_attest_milestone(&stranger, &id, &0, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::Unauthorized.into())));
}

#[test]
fn test_get_milestone_returns_recorded_outcomes() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(3);

    assert_eq!(client.get_milestone(&id, &0), None);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
    client.attest_milestone(&issuer, &id, &1, &CommitmentStatus::Late);

    assert_eq!(
        client.get_milestone(&id, &0),
        Some(CommitmentStatus::Fulfilled)
    );
    assert_eq!(client.get_milestone(&id, &1), Some(CommitmentStatus::Late));
    assert_eq!(client.get_milestone(&id, &2), None);
}

#[test]
fn test_get_milestone_rejects_an_out_of_range_index() {
    let (_env, client, _issuer, _counterparty, id) = setup_milestone_commitment(2);

    let res = client.try_get_milestone(&id, &5);
    assert_eq!(res, Err(Ok(Error::InvalidMilestoneIndex.into())));
}

#[test]
fn test_get_milestone_extends_the_milestone_ttl() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, client, issuer, _counterparty, id) = setup_milestone_commitment(2);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);

    let key = crate::commitments::DataKey::Milestone(id, 0);
    let ttl = || env.as_contract(&client.address, || env.storage().persistent().get_ttl(&key));

    // Age the entry past the bump threshold without letting it expire.
    let aged_by =
        crate::commitments::TTL_EXTEND_LEDGERS - crate::commitments::TTL_THRESHOLD_LEDGERS + 10_000;
    env.ledger().with_mut(|l| l.sequence_number += aged_by);
    assert!(ttl() < crate::commitments::TTL_THRESHOLD_LEDGERS);

    assert_eq!(
        client.get_milestone(&id, &0),
        Some(CommitmentStatus::Fulfilled)
    );
    assert_eq!(ttl(), crate::commitments::TTL_EXTEND_LEDGERS);
}

#[test]
fn test_reputation_counts_a_milestone_commitment_once() {
    let (_env, client, issuer, _counterparty, id) = setup_milestone_commitment(3);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Fulfilled);
    client.attest_milestone(&issuer, &id, &1, &CommitmentStatus::Fulfilled);
    assert_eq!(client.get_reputation(&issuer).fulfilled_count, 0);

    client.attest_milestone(&issuer, &id, &2, &CommitmentStatus::Fulfilled);
    let reputation = client.get_reputation(&issuer);
    assert_eq!(reputation.fulfilled_count, 1);
    assert_eq!(reputation.late_count, 0);
    assert_eq!(reputation.breached_count, 0);
}

#[test]
fn test_milestone_attested_events_emitted() {
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{symbol_short, FromVal, IntoVal, Val, Vec};

    let (env, client, issuer, _counterparty, id) = setup_milestone_commitment(2);

    client.attest_milestone(&issuer, &id, &0, &CommitmentStatus::Late);

    let events = env.events().all();
    assert_eq!(events.len(), 1);
    let milestone_event = events.get(0).unwrap();
    let expected_topics: Vec<Val> = (symbol_short!("milestone"), id).into_val(&env);
    assert_eq!(milestone_event.0, client.address);
    assert_eq!(milestone_event.1, expected_topics);
    assert_eq!(
        <(u32, CommitmentStatus)>::from_val(&env, &milestone_event.2),
        (0u32, CommitmentStatus::Late)
    );

    client.attest_milestone(&issuer, &id, &1, &CommitmentStatus::Fulfilled);

    let events = env.events().all();
    assert_eq!(events.len(), 2);
    assert_eq!(
        <(u32, CommitmentStatus)>::from_val(&env, &events.get(0).unwrap().2),
        (1u32, CommitmentStatus::Fulfilled)
    );

    let attested_event = events.get(1).unwrap();
    let expected_attested_topics: Vec<Val> = (symbol_short!("attested"), id).into_val(&env);
    assert_eq!(attested_event.1, expected_attested_topics);
    assert_eq!(
        CommitmentStatus::from_val(&env, &attested_event.2),
        CommitmentStatus::Late
    );
}

#[test]
fn test_single_milestone_commitment_emits_no_milestone_event() {
    use soroban_sdk::testutils::Events;

    let (env, client, issuer, counterparty, resolver) = setup_test();

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let terms_hash = BytesN::from_array(&env, &[1u8; 32]);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &2000,
        &resolver,
        &Vec::new(&env),
        &0,
    );

    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);

    assert_eq!(env.events().all().len(), 1);
}
