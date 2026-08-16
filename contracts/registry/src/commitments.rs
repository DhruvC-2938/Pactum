use soroban_sdk::{contracttype, Address, BytesN, Vec};

/// The default dispute window in seconds (7 days = 604,800 seconds).
/// A party may raise a dispute within this duration after an attestation occurs.
pub const DISPUTE_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;

/// The fallback timeout in seconds applied on top of `due_at` for M-of-N
/// attestor voting (7 days = 604,800 seconds).
/// If the required threshold of attestor votes is not reached by
/// `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`, the commitment falls back to a
/// predefined fallback state so that funds/state are not locked forever.
pub const ATTESTOR_VOTE_TIMEOUT_SECONDS: u64 = 7 * 24 * 60 * 60;

/// The threshold in ledgers below which we extend the TTL. (Approx 14 days at 5s/ledger = 241,920)
pub const TTL_THRESHOLD_LEDGERS: u32 = 14 * 17280;

/// The amount in ledgers to extend the TTL to. (Approx 30 days at 5s/ledger = 518,400)
pub const TTL_EXTEND_LEDGERS: u32 = 30 * 17280;

/// Represents the current lifecycle state of a commitment.
///
/// # Variants
/// * `Pending` - The commitment has been created and is awaiting fulfillment or breach.
/// * `Fulfilled` - The commitment was successfully fulfilled.
/// * `Late` - The commitment was fulfilled after the due date.
/// * `Breached` - The commitment was breached or defaulted upon.
/// * `Disputed` - The commitment outcome is disputed by one of the parties.
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
    /// Commitment outcome is disputed by one of the parties.
    Disputed,
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
    /// Dynamically sized list of attestors assigned to adjudicate high-value
    /// commitments via M-of-N voting. Empty for regular single-party commitments.
    pub attestors: Vec<Address>,
    /// Number of attestor votes required to resolve the commitment (M in M-of-N).
    /// Must be `0` when `attestors` is empty and between `1` and
    /// `attestors.len()` otherwise.
    pub threshold: u32,
}

/// Running vote tally for an M-of-N commitment, kept as a struct of counters so
/// that the threshold check on each vote is O(1) and never iterates the full
/// attestor set (preventing gas limit exhaustion on the final vote).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteTally {
    /// Number of votes cast for `Fulfilled`.
    pub fulfilled: u32,
    /// Number of votes cast for `Late`.
    pub late: u32,
    /// Number of votes cast for `Breached`.
    pub breached: u32,
}

impl VoteTally {
    /// Returns the tally counter for the given outcome.
    pub fn counter(&self, status: CommitmentStatus) -> u32 {
        match status {
            CommitmentStatus::Fulfilled => self.fulfilled,
            CommitmentStatus::Late => self.late,
            CommitmentStatus::Breached => self.breached,
            _ => 0,
        }
    }

    /// Increments the tally counter for the given outcome.
    pub fn increment(&mut self, status: CommitmentStatus) {
        match status {
            CommitmentStatus::Fulfilled => {
                self.fulfilled = self.fulfilled.saturating_add(1);
            }
            CommitmentStatus::Late => {
                self.late = self.late.saturating_add(1);
            }
            CommitmentStatus::Breached => {
                self.breached = self.breached.saturating_add(1);
            }
            _ => {}
        }
    }
}

/// Storage keys used for persisting commitments and contract state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Persistent storage key for a Commitment by its unique ID.
    Commitment(u64),
    /// Persistent storage key recording how a specific attestor voted on a
    /// commitment. Presence indicates the attestor has already voted.
    VoteRecord(u64, Address),
    /// Persistent storage key for the running `VoteTally` of a commitment.
    VoteTally(u64),
    /// Instance storage key for the incrementing counter of IDs.
    NextId,
    /// Instance storage key for the designated Arbitrator address.
    Arbitrator,
}

