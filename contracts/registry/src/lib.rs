#![no_std]

pub mod attestation;
pub mod commitments;
pub mod disputes;
pub mod errors;
pub mod events;
pub mod reputation;

#[cfg(test)]
mod test;

pub use commitments::DISPUTE_WINDOW_SECONDS;
use commitments::{Commitment, CommitmentStatus, DataKey};
use errors::Error;
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, BytesN, Env};

/// The Pactum Registry contract for recording and tracking recurring commitments.
#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    /// Initializes the contract with a designated arbitrator address.
    /// Can only be called once.
    ///
    /// # Authorization
    /// * Authorized caller: `arbitrator` (via `require_auth`).
    /// * Why: Requiring the designated arbitrator to authorize initialization ensures
    ///   that an address cannot be appointed as arbitrator without its explicit consent.
    ///
    /// # Panics
    /// * Panics with `Error::AlreadyInitialized` if called more than once.
    pub fn initialize(env: Env, arbitrator: Address) {
        if env.storage().instance().has(&DataKey::Arbitrator) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        arbitrator.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Arbitrator, &arbitrator);
    }

    /// Retrieves the designated arbitrator address.
    ///
    /// # Panics
    /// * Panics with `Error::NotInitialized` if the contract has not been initialized.
    pub fn get_arbitrator(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Arbitrator)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Creates and registers a new ongoing commitment between an issuer and a counterparty.
    ///
    /// # Authorization
    /// * Authorized caller: `issuer` (via `require_auth`).
    /// * Why: Only the party issuing (promising) the commitment should be able to create
    ///   and bind themselves to a new commitment on-chain.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `issuer` - The address making the commitment. Must authorize the call.
    /// * `counterparty` - The address to whom the commitment is owed.
    /// * `terms_hash` - A 32-byte hash representing the off-chain terms of the commitment.
    /// * `due_at` - Unix timestamp (seconds) when the commitment is due. Must be in the future.
    ///
    /// # Returns
    /// * `u64` - The unique identifier assigned to the created commitment.
    ///
    /// # Panics
    /// * Panics with `Error::DueAtInPast` if `due_at` is less than or equal to the current ledger timestamp.
    pub fn create_commitment(
        env: Env,
        issuer: Address,
        counterparty: Address,
        terms_hash: BytesN<32>,
        due_at: u64,
    ) -> u64 {
        // 1. Require authorization from the issuer.
        issuer.require_auth();

        // 2. Validate due_at is in the future relative to the current ledger timestamp.
        let now = env.ledger().timestamp();
        if due_at <= now {
            panic_with_error!(&env, Error::DueAtInPast);
        }

        // 3. Assign the next available ID.
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1);
        let next_id = id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        env.storage().instance().set(&DataKey::NextId, &next_id);

        // 4. Create the Commitment object with Pending status.
        let commitment = Commitment {
            id,
            issuer: issuer.clone(),
            counterparty: counterparty.clone(),
            terms_hash,
            due_at,
            status: CommitmentStatus::Pending,
            created_at: now,
            attested_at: None,
        };

        // 5. Store in persistent storage keyed by id.
        env.storage()
            .persistent()
            .set(&DataKey::Commitment(id), &commitment);

        // 6. Emit Created event.
        events::commitment_created(&env, id, &issuer, &counterparty);

        id
    }

    /// Retrieves an existing commitment by its unique ID.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment to retrieve.
    ///
    /// # Returns
    /// * `Commitment` - The commitment details and status.
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the ID does not exist in storage.
    pub fn get_commitment(env: Env, id: u64) -> Commitment {
        env.storage()
            .persistent()
            .get(&DataKey::Commitment(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::CommitmentNotFound))
    }

    /// Attests to the lifecycle status of a commitment.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be either the
    ///   commitment's `issuer` or `counterparty`.
    /// * Why: Only the participating parties involved in the commitment are authorized
    ///   to attest to its outcome.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The address attesting to the commitment. Must authorize the call and be issuer or counterparty.
    /// * `id` - The unique identifier of the commitment to attest.
    /// * `outcome` - The new lifecycle status (`Fulfilled`, `Late`, or `Breached`).
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    /// * Panics with `Error::Unauthorized` if `caller` is neither `issuer` nor `counterparty`.
    /// * Panics with `Error::InvalidOutcome` if `outcome` is `CommitmentStatus::Pending` or `Disputed`.
    /// * Panics with `Error::AlreadyResolved` if the commitment is not currently `Pending`.
    pub fn attest(env: Env, caller: Address, id: u64, outcome: CommitmentStatus) {
        attestation::attest(&env, caller, id, outcome);
    }

    /// Checks whether a commitment is overdue.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment to check.
    ///
    /// # Returns
    /// * `bool` - True if the commitment is still `Pending` and the ledger timestamp is greater than `due_at`.
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    pub fn is_overdue(env: Env, id: u64) -> bool {
        attestation::is_overdue(&env, id)
    }

    /// Raises a dispute on an attested commitment within the dispute window.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be either the
    ///   commitment's `issuer` or `counterparty`.
    /// * Why: Only the participating parties to the commitment have standing to contest
    ///   an attested outcome and initiate a dispute.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The address initiating the dispute. Must authorize the call.
    /// * `id` - The unique identifier of the commitment to dispute.
    pub fn dispute(env: Env, caller: Address, id: u64) {
        disputes::dispute(&env, caller, id);
    }

    /// Resolves a disputed commitment to a final outcome.
    ///
    /// # Authorization
    /// * Authorized caller: `arbitrator` (via `require_auth`), which must exactly match
    ///   the designated arbitrator address stored at contract initialization.
    /// * Why: Only the mutually trusted, designated arbitrator is authorized to adjudicate
    ///   and resolve contested commitments.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `arbitrator` - The designated arbitrator address resolving the dispute. Must authorize the call.
    /// * `id` - The unique identifier of the disputed commitment.
    /// * `final_outcome` - The resolution status (`Fulfilled`, `Late`, or `Breached`).
    pub fn resolve_dispute(
        env: Env,
        arbitrator: Address,
        id: u64,
        final_outcome: CommitmentStatus,
    ) {
        disputes::resolve_dispute(&env, arbitrator, id, final_outcome);
    }
}

