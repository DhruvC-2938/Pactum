//! Reentrancy guard for state-mutating registry functions (TrustGate Phase B).
//!
//! Soroban's authorization framework can invoke arbitrary contract code
//! (a custom account's `__check_auth`) as part of resolving `require_auth`,
//! and any registry function may in the future call out to other contracts.
//! Either path gives an untrusted contract a window to call back into the
//! registry before the original call has finished mutating state. This
//! guard closes that window: every state-mutating entry point calls
//! [`enter`] as its first statement (before `require_auth`) and [`exit`]
//! after its state changes are committed, so a nested call into any
//! guarded function fails fast with `Error::ReentrantCall` instead of
//! observing or corrupting half-updated state.

use crate::errors::Error;
use soroban_sdk::{contracttype, panic_with_error, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum GuardKey {
    Locked,
}

/// Marks entry into a guarded, state-mutating region of the contract.
///
/// # Panics
/// * Panics with `Error::ReentrantCall` if a guarded call is already in progress.
pub fn enter(env: &Env) {
    let locked = env
        .storage()
        .instance()
        .get(&GuardKey::Locked)
        .unwrap_or(false);
    if locked {
        panic_with_error!(env, Error::ReentrantCall);
    }
    env.storage().instance().set(&GuardKey::Locked, &true);
}

/// Releases the guard, allowing subsequent (non-nested) guarded calls to proceed.
pub fn exit(env: &Env) {
    env.storage().instance().set(&GuardKey::Locked, &false);
}
