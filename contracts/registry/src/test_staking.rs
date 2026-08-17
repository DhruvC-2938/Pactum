//! Tests for the attestor staking vault (Issue 86, Phase 1).

use crate::commitments::DataKey;
use crate::errors::Error;
use crate::staking::{AttestorStake, UNBONDING_PERIOD_SECONDS};
use crate::{RegistryContract, RegistryContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// Unix seconds at which tests start; advanced via `env.ledger().with_mut`.
const T0: u64 = 1_000_000;

/// Builds an initialized registry with a configured staking asset.
///
/// Returns the environment, the registry client, the token address, the
/// arbitrator, and a fresh attestor with `minted` units of the staking asset.
fn setup_with_staking(
    env: &Env,
    minted: i128,
) -> (RegistryContractClient<'static>, Address, Address, Address) {
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(env, &contract_id);

    let arbitrator = Address::generate(env);
    client.initialize(&arbitrator);

    let token = env
        .register_stellar_asset_contract_v2(arbitrator.clone())
        .address();
    client.set_staking_token(&arbitrator, &token);

    let attestor = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&attestor, &minted);

    env.ledger().with_mut(|l| l.timestamp = T0);

    (client, token, arbitrator, attestor)
}

#[test]
fn test_set_staking_token_requires_arbitrator() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);

    let arbitrator = Address::generate(&env);
    client.initialize(&arbitrator);

    let stranger = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(arbitrator.clone())
        .address();

    let res = client.try_set_staking_token(&stranger, &token);
    assert_eq!(res, Err(Ok(Error::NotArbitrator.into())));

    // The designated arbitrator can install the token, and only once.
    client.set_staking_token(&arbitrator, &token);
    let res = client.try_set_staking_token(&arbitrator, &token);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized.into())));
}

#[test]
fn test_stake_rejects_zero_amount() {
    let env = Env::default();
    let (client, _token, _arbitrator, attestor) = setup_with_staking(&env, 10_000);

    let res = client.try_stake_attestor(&attestor, &0);
    assert_eq!(res, Err(Ok(Error::ZeroAmount.into())));

    let res = client.try_stake_attestor(&attestor, &-5);
    assert_eq!(res, Err(Ok(Error::ZeroAmount.into())));
}

#[test]
fn test_stake_locks_funds_into_vault() {
    let env = Env::default();
    let (client, token, _arbitrator, attestor) = setup_with_staking(&env, 10_000);

    client.stake_attestor(&attestor, &7_500);

    let stake = client.get_stake_info(&attestor);
    assert_eq!(
        stake,
        AttestorStake {
            staked: 7_500,
            unbonding_until: None,
            locked: false,
        }
    );

    // 7,500 moved from the attestor into the contract vault.
    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&attestor), 2_500);
    assert_eq!(token_client.balance(&client.address), 7_500);
}

#[test]
fn test_unstake_requires_stake_first() {
    let env = Env::default();
    let (client, _token, _arbitrator, attestor) = setup_with_staking(&env, 10_000);

    let res = client.try_request_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::InsufficientStake.into())));
}

#[test]
fn test_two_week_unbonding_period() {
    let env = Env::default();
    let (client, token, _arbitrator, attestor) = setup_with_staking(&env, 10_000);

    client.stake_attestor(&attestor, &10_000);
    client.request_unstake(&attestor);

    let stake = client.get_stake_info(&attestor);
    assert_eq!(stake.unbonding_until, Some(T0 + UNBONDING_PERIOD_SECONDS));

    // A second request while unbonding is rejected.
    let res = client.try_request_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::UnbondingPending.into())));

    // Withdrawal is rejected until the period fully elapses.
    let res = client.try_finalize_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::UnbondingNotElapsed.into())));

    // One second before the deadline is still not enough.
    env.ledger().with_mut(|l| {
        l.timestamp = T0 + UNBONDING_PERIOD_SECONDS - 1;
    });
    let res = client.try_finalize_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::UnbondingNotElapsed.into())));

    // At the deadline the withdrawal succeeds and the vault is drained.
    env.ledger().with_mut(|l| {
        l.timestamp = T0 + UNBONDING_PERIOD_SECONDS;
    });
    client.finalize_unstake(&attestor);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&attestor), 10_000);
    assert_eq!(token_client.balance(&client.address), 0);

    // The record is fully cleared, so a fresh unstake is rejected again.
    assert_eq!(
        client.get_stake_info(&attestor),
        AttestorStake {
            staked: 0,
            unbonding_until: None,
            locked: false,
        }
    );
    let res = client.try_finalize_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::InsufficientStake.into())));
}

#[test]
fn test_locked_stake_blocks_unstake_and_withdrawal() {
    let env = Env::default();
    let (client, _token, _arbitrator, attestor) = setup_with_staking(&env, 10_000);

    client.stake_attestor(&attestor, &10_000);

    // The voting phase marks the attestor as locked on an active dispute panel.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(
            &DataKey::Stake(attestor.clone()),
            &AttestorStake {
                staked: 10_000,
                unbonding_until: None,
                locked: true,
            },
        );
    });

    let res = client.try_request_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::DisputeActive.into())));

    // An unstake requested before the lock cannot be withdrawn while locked.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(
            &DataKey::Stake(attestor.clone()),
            &AttestorStake {
                staked: 10_000,
                unbonding_until: Some(T0 + UNBONDING_PERIOD_SECONDS),
                locked: true,
            },
        );
    });
    env.ledger().with_mut(|l| {
        l.timestamp = T0 + UNBONDING_PERIOD_SECONDS + 1;
    });
    let res = client.try_finalize_unstake(&attestor);
    assert_eq!(res, Err(Ok(Error::DisputeActive.into())));

    // Once the dispute resolves (lock cleared), the withdrawal proceeds.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(
            &DataKey::Stake(attestor.clone()),
            &AttestorStake {
                staked: 10_000,
                unbonding_until: Some(T0 + UNBONDING_PERIOD_SECONDS),
                locked: false,
            },
        );
    });
    client.finalize_unstake(&attestor);
    assert_eq!(client.get_stake_info(&attestor).staked, 0);
}

#[test]
fn test_reentrant_stake_call_is_rejected() {
    let env = Env::default();
    let (client, _token, _arbitrator, attestor) = setup_with_staking(&env, 10_000);

    // Simulate a stuck guard (as if a nested call were already in progress)
    // and verify a top-level mutating call is rejected while it is locked.
    env.as_contract(&client.address, || {
        crate::reentrancy::enter(&env);
    });

    let res = client.try_stake_attestor(&attestor, &1_000);
    assert_eq!(res, Err(Ok(Error::ReentrantCall.into())));

    env.as_contract(&client.address, || {
        crate::reentrancy::exit(&env);
    });

    // Once released, the call succeeds normally.
    client.stake_attestor(&attestor, &1_000);
    assert_eq!(client.get_stake_info(&attestor).staked, 1_000);
}
