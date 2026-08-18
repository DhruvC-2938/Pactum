//! Emergency pause (kill-switch) control for the Pactum registry.
//!
//! In the event of a zero-day exploit, the protocol admin can flip the
//! `Paused` flag so that every protocol state-mutating entry point reverts
//! with `Error::ProtocolPaused`, while read-only functions continue to work.
//! The admin controls the flag via `pause` / `unpause`; the toggle itself is
//! not gated so the admin always retains the ability to act. Admin lifecycle
//! operations (`pause`, `unpause`, `upgrade`) are deliberately exempt from the
//! pause so the admin can end the halt or deploy an emergency patch while the
//! protocol is paused.

use crate::commitments::DataKey;
use crate::errors::Error;
use soroban_sdk::{panic_with_error, Env};

/// Returns `true` if the protocol is currently paused (emergency halt).
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

/// Panics with `Error::ProtocolPaused` if the protocol is currently paused.
///
/// Called as the first statement of every state-mutating entry point so
/// writes are halted immediately while reads remain unaffected.
///
/// # Panics
/// * Panics with `Error::ProtocolPaused` if the protocol is paused.
pub fn require_not_paused(env: &Env) {
    if is_paused(env) {
        panic_with_error!(env, Error::ProtocolPaused);
    }
}

/// Sets the paused flag and extends the instance TTL of the storage key.
pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
    env.storage().instance().extend_ttl(
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );
}
