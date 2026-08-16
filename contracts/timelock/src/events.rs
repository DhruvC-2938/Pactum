//! Timelock event surface.
//!
//! These events are the mechanism by which the 7-day review window actually reaches
//! integrating protocols: `queued` carries the pinned Wasm hash and the `eta`, so an
//! indexer can alert on a pending upgrade the moment it is proposed rather than the
//! moment it lands.

use crate::types::{Proposal, ProposalState};
use soroban_sdk::{symbol_short, Address, Env};

/// Published when the Timelock is initialized.
pub fn initialized(env: &Env, admin: &Address, guardian: &Address, delay: u64) {
    env.events().publish(
        (symbol_short!("tl_init"), admin.clone(), guardian.clone()),
        delay,
    );
}

/// Published when a proposal is queued. Carries the full pinned proposal.
pub fn queued(env: &Env, proposal: &Proposal) {
    env.events().publish(
        (
            symbol_short!("queued"),
            proposal.id,
            proposal.target.clone(),
        ),
        proposal.clone(),
    );
}

/// Published when a queued proposal is cancelled, naming who cancelled it.
pub fn cancelled(env: &Env, id: u64, by: &Address) {
    env.events()
        .publish((symbol_short!("cancelled"), id), by.clone());
}

/// Published when a proposal executes successfully.
pub fn executed(env: &Env, proposal: &Proposal) {
    env.events().publish(
        (
            symbol_short!("executed"),
            proposal.id,
            proposal.target.clone(),
        ),
        proposal.action.clone(),
    );
}

/// Published when admin authority is rotated. Carries the new epoch, since the epoch
/// bump is what invalidates in-flight proposals.
pub fn admin_transferred(env: &Env, old: &Address, new: &Address, new_epoch: u32) {
    env.events().publish(
        (symbol_short!("tl_admin"), old.clone(), new.clone()),
        new_epoch,
    );
}

/// Published when guardian authority is rotated.
pub fn guardian_transferred(env: &Env, old: &Address, new: &Address) {
    env.events()
        .publish((symbol_short!("tl_guard"), old.clone()), new.clone());
}

/// Published when the execution delay is changed.
pub fn delay_updated(env: &Env, old: u64, new: u64) {
    env.events()
        .publish((symbol_short!("tl_delay"),), (old, new));
}

/// Published when a proposal's state changes, for indexers that track lifecycle only.
pub fn state_changed(env: &Env, id: u64, state: ProposalState) {
    env.events().publish((symbol_short!("tl_state"), id), state);
}
