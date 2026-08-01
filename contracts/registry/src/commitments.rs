use soroban_sdk::{contracttype, Address, BytesN};

/// Represents the current lifecycle state of a commitment.
///
/// # Variants
/// * `Pending` - The commitment has been created and is awaiting fulfillment or breach.
/// * `Fulfilled` - The commitment was successfully fulfilled.
/// * `Late` - The commitment was fulfilled after the due date.
/// * `Breached` - The commitment was breached or defaulted upon.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitmentStatus {
    /// Commitment has been created and is awaiting fulfillment or breach.
    Pending,
    /// Commitment was successfully fulfilled.
    Fulfilled,
    /// Commitment was fulfilled after the due date.
    Late,
    /// Commitment was breached or defaulted upon.
    Breached,
}

/// A registered recurring or ongoing commitment between two parties on Stellar.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Commitment {
    /// Unique identifier for this commitment.
    pub id: u64,
    /// The party making the commitment.
    pub issuer: Address,
    /// The party the commitment is owed to.
    pub counterparty: Address,
    /// Hash of the off-chain terms/description.
    pub terms_hash: BytesN<32>,
    /// Unix timestamp (seconds) when the commitment is due.
    pub due_at: u64,
    /// Current lifecycle status of the commitment.
    pub status: CommitmentStatus,
    /// Unix timestamp (seconds) when the commitment was created.
    pub created_at: u64,
    /// Unix timestamp (seconds) when the commitment was attested, if it has been attested.
    pub attested_at: Option<u64>,
}

/// Storage keys used for persisting commitments and contract state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Persistent storage key for a Commitment by its unique ID.
    Commitment(u64),
    /// Instance storage key for the incrementing counter of IDs.
    NextId,
}
