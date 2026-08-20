//! Governance parameters, proposal shape, and storage keys for the Timelock.

use soroban_sdk::{contracttype, Address, BytesN};

/// Hard floor on the execution delay: 7 days, in seconds.
///
/// This is a compile-time constant, not a configurable parameter. `initialize` and
/// `set_delay` both refuse any value below it, so the review window that integrating
/// protocols rely on cannot be shortened by the admin, by a compromised key, or by a
/// governance vote — only by upgrading the Timelock itself, which the Timelock does
/// not have an entrypoint for.
pub const MIN_DELAY_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Ceiling on the execution delay, to stop a typo from parking governance forever.
pub const MAX_DELAY_SECONDS: u64 = 90 * 24 * 60 * 60;

/// How long after `eta` a matured proposal stays executable: 14 days, in seconds.
///
/// Without an expiry, a proposal approved under one set of circumstances could sit
/// dormant and be executed years later against a protocol that has moved on. Once the
/// grace period lapses the proposal is dead and must be re-queued, which restarts the
/// full delay.
pub const GRACE_PERIOD_SECONDS: u64 = 14 * 24 * 60 * 60;

/// The governance action a proposal will perform on its target when executed.
///
/// Deliberately a closed set rather than an arbitrary `(symbol, args)` call. A generic
/// call-anything timelock is a strictly larger attack surface: it would let a
/// compromised admin queue calls to entrypoints nobody reviewed this mechanism for,
/// and it would make static review of a queued proposal much harder. Extending this
/// enum requires upgrading the Timelock, which is itself a deliberate act.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    /// Replace the target's executable with `wasm_hash` and move it to schema version
    /// `schema_version`, atomically.
    ///
    /// The Wasm hash is stored here at queue time and is never re-read from anywhere
    /// else at execution. That pinning is what makes the delay meaningful: the bytes
    /// reviewers inspect during the window are exactly the bytes that run.
    Upgrade(BytesN<32>, u32),
    /// Hand the target's upgrade authority to a different address.
    SetUpgradeAdmin(Address),
}

/// Lifecycle state of a proposal.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalState {
    /// Queued and awaiting its `eta`.
    Queued,
    /// Already executed. Terminal — re-execution is rejected.
    Executed,
    /// Cancelled by the admin or the guardian. Terminal.
    Cancelled,
}

/// A queued governance action.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    /// Monotonic identifier, unique for the life of this Timelock.
    pub id: u64,
    /// Contract this proposal acts on.
    pub target: Address,
    /// What will be done to the target. Pinned at queue time.
    pub action: ProposalAction,
    /// Address that queued the proposal (the admin at the time).
    pub proposer: Address,
    /// Admin epoch this proposal was queued under.
    ///
    /// Execution requires this to still match the Timelock's current epoch. Rotating
    /// the admin bumps the epoch and therefore invalidates every in-flight proposal in
    /// one step, without the incoming admin having to enumerate and cancel them.
    pub admin_epoch: u32,
    /// Ledger timestamp at which the proposal was queued.
    pub queued_at: u64,
    /// Earliest ledger timestamp at which the proposal may execute.
    pub eta: u64,
    /// Ledger timestamp after which the proposal can no longer execute.
    pub expires_at: u64,
    /// Current lifecycle state.
    pub state: ProposalState,
    /// Hash of the off-chain rationale: the diff, the build attestation, the vote.
    ///
    /// Not interpreted on-chain. It exists so the 7-day window has something for
    /// integrators to review *against* — see the runbook in `docs/upgradeability.md`.
    pub description_hash: BytesN<32>,
}

/// Storage keys used by the Timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TimelockKey {
    /// Instance storage: the address that may queue and execute proposals.
    Admin,
    /// Instance storage: the address that may cancel proposals, and must co-sign
    /// admin/guardian rotation.
    Guardian,
    /// Instance storage: the configured delay in seconds. Never below `MIN_DELAY_SECONDS`.
    Delay,
    /// Instance storage: monotonic counter bumped on every admin rotation.
    AdminEpoch,
    /// Instance storage: next proposal id to hand out.
    NextProposalId,
    /// Persistent storage: a proposal by id.
    Proposal(u64),
}

/// TTL threshold and extension, matching the registry contract's conventions.
pub const TTL_THRESHOLD_LEDGERS: u32 = 14 * 17280;
/// TTL extension target, matching the registry contract's conventions.
pub const TTL_EXTEND_LEDGERS: u32 = 30 * 17280;
