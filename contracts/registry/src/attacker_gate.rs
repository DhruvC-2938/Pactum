//! AttackerGate: a malicious mock contract used to prove that a
//! cross-contract reentrancy attempt during dispute resolution cannot
//! corrupt registry state (TrustGate Phase B).
//!
//! Soroban invokes a custom account contract's `__check_auth` as part of
//! resolving `require_auth`. `AttackerGate` is registered as the
//! commitment's arbitrator and implements `CustomAccountInterface`; from
//! within `__check_auth` — i.e. mid-flight, before `resolve_dispute` has
//! applied any state changes — it attempts to call back into
//! `resolve_dispute` for the same commitment to try to double-process it
//! and corrupt reputation counts.
//!
//! The attempt is rejected. In practice it is rejected twice over: Soroban's
//! host refuses by default to invoke a contract that is already present on
//! the current call stack (the registry is still executing the outer
//! `resolve_dispute`), so the nested call typically never even reaches the
//! registry's WASM code. The registry's own `reentrancy` guard (see
//! `reentrancy.rs`) is the second, explicit layer: it is what actually fires
//! if that host-level protection is ever bypassed or relaxed (e.g. a future
//! change that opts a function into reentrant calls), and it is exercised
//! directly by `test_reentrant_attest_call_is_rejected` in `test.rs`.

#![cfg(test)]

use crate::commitments::CommitmentStatus;
use crate::errors::Error;
use crate::RegistryContractClient;
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl, contracttype,
    crypto::Hash,
    Address, Env, Val, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Registry,
    CommitmentId,
    ReentryBlocked,
    DiagCode,
}

#[contract]
pub struct AttackerGate;

#[contractimpl]
impl AttackerGate {
    /// Configures which registry contract and commitment to target once
    /// `__check_auth` is invoked.
    pub fn init(env: Env, registry: Address, commitment_id: u64) {
        env.storage().instance().set(&DataKey::Registry, &registry);
        env.storage()
            .instance()
            .set(&DataKey::CommitmentId, &commitment_id);
    }

    /// True if the reentrant call attempted inside `__check_auth` was
    /// rejected (by the host's call-stack protection, the registry's own
    /// reentrancy guard, or both), as expected.
    pub fn reentry_was_blocked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::ReentryBlocked)
            .unwrap_or(false)
    }

    /// Diagnostic code for the reentrant call's outcome: `0` if it
    /// unexpectedly succeeded, `1000 + code` if it failed with a Soroban
    /// `Error` carrying that major code, or `-1` if it failed at the
    /// host/invocation level before returning a contract-level error.
    pub fn diag_code(env: Env) -> i64 {
        env.storage()
            .instance()
            .get(&DataKey::DiagCode)
            .unwrap_or(-999)
    }
}

#[contractimpl]
impl CustomAccountInterface for AttackerGate {
    type Signature = Val;
    type Error = Error;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        _signature_payload: Hash<32>,
        _signature: Val,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let registry: Address = env.storage().instance().get(&DataKey::Registry).unwrap();
        let commitment_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CommitmentId)
            .unwrap();
        let self_address = env.current_contract_address();

        let registry_client = RegistryContractClient::new(&env, &registry);

        // Attempt to re-enter `resolve_dispute` for the same commitment,
        // mid-flight, while the outer resolve_dispute call (whose
        // require_auth triggered this __check_auth) is still in progress
        // and has not yet applied its state changes. A `try_` call so that a
        // rejection here does not itself abort the outer, legitimate call.
        let reentry_result = registry_client.try_resolve_dispute(
            &self_address,
            &commitment_id,
            &CommitmentStatus::Breached,
        );

        // Blocked if the call failed for *any* reason: either the host's
        // built-in call-stack protection or our own `Error::ReentrantCall`.
        // What must never happen is `Ok(_)` (the reentrant call succeeding).
        let (blocked, diag): (bool, i64) = match reentry_result {
            Ok(_) => (false, 0),
            Err(Ok(e)) => (true, 1000 + e.get_code() as i64),
            Err(Err(_)) => (true, -1),
        };
        env.storage()
            .instance()
            .set(&DataKey::ReentryBlocked, &blocked);
        env.storage().instance().set(&DataKey::DiagCode, &diag);

        // Authorize regardless, so the legitimate outer call can proceed and
        // the test can assert on both the final state and `blocked` above.
        Ok(())
    }
}
