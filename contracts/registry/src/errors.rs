use soroban_sdk::contracterror;

/// Custom errors for the Pactum registry contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The specified due date is in the past relative to the current ledger timestamp.
    DueAtInPast = 1,
    /// No commitment was found with the specified ID.
    CommitmentNotFound = 2,
}
