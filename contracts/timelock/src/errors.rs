use soroban_sdk::contracterror;

/// Custom errors for the Pactum timelock contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The contract has already been initialized.
    AlreadyInitialized = 1,
    /// The contract has not been initialized.
    NotInitialized = 2,
    /// The caller is not the admin.
    NotAdmin = 3,
    /// The caller is neither the admin nor the guardian.
    NotAdminOrGuardian = 4,
    /// The requested delay is below `MIN_DELAY_SECONDS`.
    DelayTooShort = 5,
    /// The requested delay is above `MAX_DELAY_SECONDS`.
    DelayTooLong = 6,
    /// No proposal exists with the specified id.
    ProposalNotFound = 7,
    /// The proposal is not in the `Queued` state — already executed or cancelled.
    ProposalNotQueued = 8,
    /// The proposal's `eta` has not been reached yet.
    TimelockNotElapsed = 9,
    /// The proposal's grace period has lapsed; it must be re-queued.
    ProposalExpired = 10,
    /// The proposal was queued under a superseded admin epoch.
    ProposalStale = 11,
    /// Numerical overflow occurred when calculating an id or a timestamp.
    Overflow = 12,
    /// The proposed schema version is not a valid forward target.
    InvalidSchemaVersion = 13,
}
