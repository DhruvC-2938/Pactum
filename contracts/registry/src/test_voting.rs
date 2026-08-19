//! Tests for M-of-N attestor voting and slashing (Issue 86, Phase 2).

use crate::commitments::CommitmentStatus;
use crate::errors::Error;
use crate::staking::AttestorStake;
use crate::{RegistryContract, RegistryContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Vec,
};

/// Unix seconds at which tests start; advanced via `env.ledger().with_mut`.
const T0: u64 = 1_000_000;

/// Builds an initialized registry with a staking asset and a five-attestor
/// panel, every one of them staked `STAKE` units.
///
/// Returns the environment, the registry client, the token, the issuer, the
/// counterparty, the resolver (the arbitrator), and the panel vector.
const STAKE: i128 = 1_000;

fn setup_voting(
    env: &Env,
) -> (
    RegistryContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Vec<Address>,
) {
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(env, &contract_id);

    let arbitrator = Address::generate(env);
    client.initialize(&soroban_sdk::vec![env, arbitrator.clone()]);

    let token = env
        .register_stellar_asset_contract_v2(arbitrator.clone())
        .address();
    client.set_staking_token(&arbitrator, &token);

    // Also configure the same token as the dispute token: dispute() requires
    // a token transfer (DISPUTE_STAKE_AMOUNT) from the caller, and panics with
    // error #40 (DisputeTokenNotSet) if none is configured.
    let dispute_token = env
        .register_stellar_asset_contract_v2(arbitrator.clone())
        .address();
    client.set_dispute_token(&arbitrator, &dispute_token);

    let issuer = Address::generate(env);
    let counterparty = Address::generate(env);

    // Mint dispute tokens to both parties and each attestor, since any party
    // to a commitment can raise a dispute in these tests.
    let dispute_asset = StellarAssetClient::new(env, &dispute_token);
    let dispute_fund = crate::commitments::DISPUTE_STAKE_AMOUNT * 10;
    dispute_asset.mint(&issuer, &dispute_fund);
    dispute_asset.mint(&counterparty, &dispute_fund);

    let mut attestors = Vec::new(env);
    for _ in 0..5 {
        let attestor = Address::generate(env);
        StellarAssetClient::new(env, &token).mint(&attestor, &(STAKE * 2));
        client.stake_attestor(&attestor, &STAKE);
        // Also mint dispute tokens: panel members can be disputers.
        dispute_asset.mint(&attestor, &dispute_fund);
        attestors.push_back(attestor);
    }

    env.ledger().with_mut(|l| l.timestamp = T0);

    (client, token, arbitrator, issuer, counterparty, attestors)
}

/// Creates a panel-governed commitment, attests it as `Fulfilled`, and raises
/// a dispute on it. Returns the commitment ID.
fn disputed_panel_commitment(
    env: &Env,
    client: &RegistryContractClient<'static>,
    issuer: &Address,
    counterparty: &Address,
    resolver: &Address,
    attestors: &Vec<Address>,
    threshold: u32,
) -> u64 {
    let terms = BytesN::from_array(env, &[9u8; 32]);
    let id = client.create_commitment(
        issuer,
        counterparty,
        &terms,
        &(T0 + 60),
        resolver,
        &None,
        &None,
        attestors,
        &threshold,
    );
    client.attest(issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(issuer, &id);
    id
}

#[test]
fn test_vote_threshold_resolves_and_slashes_dissenters() {
    let env = Env::default();
    let (client, _token, _arbitrator, issuer, counterparty, attestors) = setup_voting(&env);
    let (a1, a2, a3, a4, a5) = (
        attestors.get(0).unwrap(),
        attestors.get(1).unwrap(),
        attestors.get(2).unwrap(),
        attestors.get(3).unwrap(),
        attestors.get(4).unwrap(),
    );

    let id = disputed_panel_commitment(&env, &client, &issuer, &counterparty, &a5, &attestors, 3);

    // While the dispute is active every panel member's stake is locked.
    assert_eq!(
        client.get_stake_info(&a1),
        AttestorStake {
            staked: STAKE,
            unbonding_until: None,
            locked: true,
        }
    );

    // Four votes, one dissenting: the dispute resolves to Fulfilled.
    client.cast_dispute_vote(&a1, &id, &CommitmentStatus::Fulfilled);
    client.cast_dispute_vote(&a4, &id, &CommitmentStatus::Breached);
    client.cast_dispute_vote(&a2, &id, &CommitmentStatus::Fulfilled);
    client.cast_dispute_vote(&a3, &id, &CommitmentStatus::Fulfilled);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Fulfilled);
    assert_eq!(commitment.attested_at, None);

    // The panel is unlocked, and the dissenting voter lost 10% of their stake.
    assert_eq!(
        client.get_stake_info(&a1),
        AttestorStake {
            staked: STAKE,
            unbonding_until: None,
            locked: false,
        }
    );
    assert_eq!(
        client.get_stake_info(&a4),
        AttestorStake {
            staked: STAKE - STAKE / 10,
            unbonding_until: None,
            locked: false,
        }
    );
    // Abstainers are unlocked and untouched.
    assert_eq!(
        client.get_stake_info(&a5),
        AttestorStake {
            staked: STAKE,
            unbonding_until: None,
            locked: false,
        }
    );
}

#[test]
fn test_vote_rejects_double_vote() {
    let env = Env::default();
    let (client, _token, _arbitrator, issuer, counterparty, attestors) = setup_voting(&env);
    let a1 = attestors.get(0).unwrap();

    let id = disputed_panel_commitment(
        &env,
        &client,
        &issuer,
        &counterparty,
        &attestors.get(4).unwrap(),
        &attestors,
        3,
    );

    client.cast_dispute_vote(&a1, &id, &CommitmentStatus::Fulfilled);
    let res = client.try_cast_dispute_vote(&a1, &id, &CommitmentStatus::Late);
    assert_eq!(res, Err(Ok(Error::AttestorAlreadyVoted.into())));
}

#[test]
fn test_vote_rejects_unstaked_caller() {
    let env = Env::default();
    let (client, token, _arbitrator, issuer, counterparty, attestors) = setup_voting(&env);
    let stranger = Address::generate(&env);

    // A panel containing a member with no stake at all.
    let mut panel = attestors.clone();
    panel.push_back(stranger.clone());

    let id = disputed_panel_commitment(
        &env,
        &client,
        &issuer,
        &counterparty,
        &attestors.get(4).unwrap(),
        &panel,
        3,
    );

    // A member outside the panel is not an attestor.
    let outsider = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&outsider, &(STAKE * 2));
    client.stake_attestor(&outsider, &STAKE);
    let res = client.try_cast_dispute_vote(&outsider, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::NotAttestor.into())));

    // A panel member with zero stake cannot vote.
    let res = client.try_cast_dispute_vote(&stranger, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::InsufficientStake.into())));
}

#[test]
fn test_vote_rejects_invalid_outcome_and_non_disputed() {
    let env = Env::default();
    let (client, _token, _arbitrator, issuer, counterparty, attestors) = setup_voting(&env);
    let a1 = attestors.get(0).unwrap();

    let terms = BytesN::from_array(&env, &[8u8; 32]);
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms,
        &(T0 + 60),
        &attestors.get(4).unwrap(),
        &None,
        &None,
        &attestors,
        &3,
    );

    // Pending: not votable.
    let res = client.try_cast_dispute_vote(&a1, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::InvalidTransition.into())));

    // Disputed, but Pending/Disputed are not valid votes.
    client.attest(&issuer, &id, &CommitmentStatus::Fulfilled);
    client.dispute(&issuer, &id);
    let res = client.try_cast_dispute_vote(&a1, &id, &CommitmentStatus::Pending);
    assert_eq!(res, Err(Ok(Error::InvalidOutcome.into())));
}

#[test]
fn test_vote_timeout_falls_back_to_breached() {
    let env = Env::default();
    let (client, _token, _arbitrator, issuer, counterparty, attestors) = setup_voting(&env);
    let a1 = attestors.get(0).unwrap();

    let id = disputed_panel_commitment(
        &env,
        &client,
        &issuer,
        &counterparty,
        &attestors.get(4).unwrap(),
        &attestors,
        3,
    );

    // The window has not elapsed yet: finalization is refused.
    let res = client.try_check_dispute_timeout(&id);
    assert_eq!(res, Err(Ok(Error::VotesNotMet.into())));

    // Jump past the 7-day voting window without reaching the threshold.
    env.ledger()
        .with_mut(|l| l.timestamp = T0 + crate::voting::ATTESTOR_VOTE_TIMEOUT_SECONDS + 1);

    // Voting is now closed.
    let res = client.try_cast_dispute_vote(&a1, &id, &CommitmentStatus::Fulfilled);
    assert_eq!(res, Err(Ok(Error::VotingClosed.into())));

    client.check_dispute_timeout(&id);

    let commitment = client.get_commitment(&id);
    assert_eq!(commitment.status, CommitmentStatus::Breached);
    assert_eq!(commitment.attested_at, None);

    // The panel is unlocked.
    assert_eq!(
        client.get_stake_info(&a1),
        AttestorStake {
            staked: STAKE,
            unbonding_until: None,
            locked: false,
        }
    );
}

#[test]
fn test_resolve_dispute_rejected_for_panel_commitment() {
    let env = Env::default();
    let (client, _token, _arbitrator, issuer, counterparty, attestors) = setup_voting(&env);

    let id = disputed_panel_commitment(
        &env,
        &client,
        &issuer,
        &counterparty,
        &attestors.get(4).unwrap(),
        &attestors,
        3,
    );

    let res = client.try_resolve_dispute(
        &attestors.get(4).unwrap(),
        &id,
        &CommitmentStatus::Fulfilled,
    );
    assert_eq!(res, Err(Ok(Error::UseVotingResolution.into())));
}

#[test]
fn test_create_rejects_invalid_thresholds() {
    let env = Env::default();
    let (client, _token, arbitrator, issuer, counterparty, attestors) = setup_voting(&env);
    let terms = BytesN::from_array(&env, &[7u8; 32]);

    // Threshold above panel size.
    let res = client.try_create_commitment(
        &issuer,
        &counterparty,
        &terms,
        &(T0 + 60),
        &arbitrator,
        &None,
        &None,
        &attestors,
        &6,
    );
    assert_eq!(res, Err(Ok(Error::ThresholdInvalid.into())));

    // Panel without threshold.
    let res = client.try_create_commitment(
        &issuer,
        &counterparty,
        &terms,
        &(T0 + 60),
        &arbitrator,
        &None,
        &None,
        &attestors,
        &0,
    );
    assert_eq!(res, Err(Ok(Error::ThresholdInvalid.into())));

    // Threshold without a panel.
    let empty = Vec::new(&env);
    let res = client.try_create_commitment(
        &issuer,
        &counterparty,
        &terms,
        &(T0 + 60),
        &arbitrator,
        &None,
        &None,
        &empty,
        &2,
    );
    assert_eq!(res, Err(Ok(Error::ThresholdInvalid.into())));

    // Empty panel with zero threshold is the legacy single-resolver path.
    let id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms,
        &(T0 + 60),
        &arbitrator,
        &None,
        &None,
        &empty,
        &0,
    );
    let commitment = client.get_commitment(&id);
    assert!(commitment.attestors.is_empty());
    assert_eq!(commitment.vote_threshold(), 0);
}

#[test]
fn test_vote_balance_unaffected_by_threshold_vote() {
    let env = Env::default();
    let (client, token, _arbitrator, _issuer, _counterparty, attestors) = setup_voting(&env);
    let (a1, a2) = (attestors.get(0).unwrap(), attestors.get(1).unwrap());
    let resolver = attestors.get(4).unwrap();

    let terms = BytesN::from_array(&env, &[6u8; 32]);
    let id = client.create_commitment(
        &attestors.get(3).unwrap(),
        &resolver,
        &terms,
        &(T0 + 60),
        &resolver,
        &None,
        &None,
        &attestors,
        &3,
    );
    client.attest(&attestors.get(3).unwrap(), &id, &CommitmentStatus::Late);
    client.dispute(&attestors.get(3).unwrap(), &id);

    // Voting does not move tokens; slashing only happens at resolution.
    let token_client = TokenClient::new(&env, &token);
    let vault_before = token_client.balance(&client.address);

    client.cast_dispute_vote(&a1, &id, &CommitmentStatus::Late);
    client.cast_dispute_vote(&a2, &id, &CommitmentStatus::Late);

    assert_eq!(token_client.balance(&client.address), vault_before);
}
