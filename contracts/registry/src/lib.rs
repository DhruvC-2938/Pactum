#![no_std]

pub mod attestation;
pub mod commitments;
pub mod errors;
pub mod events;
pub mod reputation;

#[cfg(test)]
mod test;

use commitments::{Commitment, CommitmentStatus, DataKey};
use errors::Error;
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, BytesN, Env};

/// The Pactum Registry contract for recording and tracking recurring commitments.
#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    /// Creates and registers a new ongoing commitment between an issuer and a counterparty.
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
        let next_id = id.checked_add(1).expect("ID overflow");
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
}
