import re

# Fix commitments.rs
with open('contracts/registry/src/commitments.rs', 'r') as f:
    c = f.read()

resolved_c = c.replace("""<<<<<<< HEAD
    /// Dynamically sized list of attestors assigned to adjudicate high-value
    /// commitments via M-of-N voting. Empty for regular single-party commitments.
    pub attestors: Vec<Address>,
    /// Number of attestor votes required to resolve the commitment (M in M-of-N).
    /// Must be `0` when `attestors` is empty and between `1` and
    /// `attestors.len()` otherwise.
    pub threshold: u32,
    /// Optional template type classifying this commitment for tooling.
    pub template: Option<TemplateType>,
=======
    /// The address of the custom resolver delegated to resolve disputes for this commitment.
    pub resolver_address: Address,
>>>>>>> origin/main""", """    /// Dynamically sized list of attestors assigned to adjudicate high-value
    /// commitments via M-of-N voting. Empty for regular single-party commitments.
    pub attestors: soroban_sdk::Vec<Address>,
    /// Number of attestor votes required to resolve the commitment (M in M-of-N).
    /// Must be `0` when `attestors` is empty and between `1` and
    /// `attestors.len()` otherwise.
    pub threshold: u32,
    /// Optional template type classifying this commitment for tooling.
    pub template: Option<TemplateType>,
    /// The address of the custom resolver delegated to resolve disputes for this commitment.
    pub resolver_address: Address,""")

resolved_c = resolved_c.replace("""<<<<<<< HEAD
=======

/// Loads a commitment from persistent storage, transparently migrating legacy records
/// that were stored before `resolver_address` was added. Legacy records inherit the
/// contract's designated arbitrator address as their fallback `resolver_address`.
pub fn get_commitment_record(env: &soroban_sdk::Env, id: u64) -> Option<Commitment> {
    let val: Val = env
        .storage()
        .persistent()
        .get(&DataKey::Commitment(id))?;

    let map = Map::<Symbol, Val>::try_from_val(env, &val).ok()?;
    let resolver_sym = Symbol::new(env, "resolver_address");

    if map.contains_key(resolver_sym) {
        return Commitment::try_from_val(env, &val).ok();
    }

    // Legacy record without resolver_address: parse fields individually and migrate
    let stored_id: u64 = map.get(Symbol::new(env, "id"))?.try_into_val(env).ok()?;
    if stored_id != id {
        return None;
    }
    let issuer: Address = map.get(Symbol::new(env, "issuer"))?.try_into_val(env).ok()?;
    let counterparty: Address = map.get(Symbol::new(env, "counterparty"))?.try_into_val(env).ok()?;
    let terms_hash: BytesN<32> = map.get(Symbol::new(env, "terms_hash"))?.try_into_val(env).ok()?;
    let due_at: u64 = map.get(Symbol::new(env, "due_at"))?.try_into_val(env).ok()?;
    let status: CommitmentStatus = map.get(Symbol::new(env, "status"))?.try_into_val(env).ok()?;
    let created_at: u64 = map.get(Symbol::new(env, "created_at"))?.try_into_val(env).ok()?;
    let attested_at: Option<u64> = match map.get(Symbol::new(env, "attested_at")) {
        Some(v) => v.try_into_val(env).ok()?,
        None => None,
    };

    let fallback_resolver = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Arbitrator)
        .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, crate::errors::Error::NotInitialized));

    let migrated = Commitment {
        id,
        issuer,
        counterparty,
        terms_hash,
        due_at,
        status,
        created_at,
        attested_at,
        resolver_address: fallback_resolver,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &migrated);

    Some(migrated)
}



>>>>>>> origin/main""", """
/// Loads a commitment from persistent storage, transparently migrating legacy records
/// that were stored before `resolver_address` was added. Legacy records inherit the
/// contract's designated arbitrator address as their fallback `resolver_address`.
pub fn get_commitment_record(env: &soroban_sdk::Env, id: u64) -> Option<Commitment> {
    let val: Val = env
        .storage()
        .persistent()
        .get(&DataKey::Commitment(id))?;

    let map = Map::<Symbol, Val>::try_from_val(env, &val).ok()?;
    let resolver_sym = Symbol::new(env, "resolver_address");

    if map.contains_key(resolver_sym.clone()) {
        return Commitment::try_from_val(env, &val).ok();
    }

    // Legacy record without resolver_address: parse fields individually and migrate
    let stored_id: u64 = map.get(Symbol::new(env, "id"))?.try_into_val(env).ok()?;
    if stored_id != id {
        return None;
    }
    let issuer: Address = map.get(Symbol::new(env, "issuer"))?.try_into_val(env).ok()?;
    let counterparty: Address = map.get(Symbol::new(env, "counterparty"))?.try_into_val(env).ok()?;
    let terms_hash: BytesN<32> = map.get(Symbol::new(env, "terms_hash"))?.try_into_val(env).ok()?;
    let due_at: u64 = map.get(Symbol::new(env, "due_at"))?.try_into_val(env).ok()?;
    let status: CommitmentStatus = map.get(Symbol::new(env, "status"))?.try_into_val(env).ok()?;
    let created_at: u64 = map.get(Symbol::new(env, "created_at"))?.try_into_val(env).ok()?;
    let attested_at: Option<u64> = match map.get(Symbol::new(env, "attested_at")) {
        Some(v) => v.try_into_val(env).ok()?,
        None => None,
    };

    let attestors_sym = Symbol::new(env, "attestors");
    let attestors: soroban_sdk::Vec<Address> = match map.get(attestors_sym.clone()) {
        Some(v) => v.try_into_val(env).unwrap_or(soroban_sdk::Vec::new(env)),
        None => soroban_sdk::Vec::new(env),
    };

    let threshold_sym = Symbol::new(env, "threshold");
    let threshold: u32 = match map.get(threshold_sym.clone()) {
        Some(v) => v.try_into_val(env).unwrap_or(0),
        None => 0,
    };

    let template_sym = Symbol::new(env, "template");
    let template: Option<TemplateType> = match map.get(template_sym.clone()) {
        Some(v) => v.try_into_val(env).unwrap_or(None),
        None => None,
    };

    let fallback_resolver = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Arbitrator)
        .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, crate::errors::Error::NotInitialized));

    let migrated = Commitment {
        id,
        issuer,
        counterparty,
        terms_hash,
        due_at,
        status,
        created_at,
        attested_at,
        attestors,
        threshold,
        template,
        resolver_address: fallback_resolver,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &migrated);

    Some(migrated)
}""")
with open('contracts/registry/src/commitments.rs', 'w') as f:
    f.write(resolved_c)

# Fix lib.rs
with open('contracts/registry/src/lib.rs', 'r') as f:
    l = f.read()

l = l.replace("""<<<<<<< HEAD
pub use commitments::DISPUTE_WINDOW_SECONDS;
use commitments::{Commitment, CommitmentStatus, DataKey, TemplateType, VoteTally};
=======
#[cfg(test)]
mod demo;

pub use commitments::{Commitment, CommitmentStatus, DataKey, DISPUTE_WINDOW_SECONDS};
>>>>>>> origin/main""", """#[cfg(test)]
mod demo;

pub use commitments::{Commitment, CommitmentStatus, DataKey, DISPUTE_WINDOW_SECONDS, TemplateType, VoteTally};""")

l = l.replace("""<<<<<<< HEAD
    /// * Panics with `Error::ThresholdInvalid` if `threshold` is `0` while attestors are assigned,
    ///   or greater than the number of attestors.
    /// * Panics with `Error::DuplicateAttestor` if the attestor list contains duplicate addresses.
    #[allow(clippy::too_many_arguments)]
=======
>>>>>>> origin/main""", """    /// * Panics with `Error::ThresholdInvalid` if `threshold` is `0` while attestors are assigned,
    ///   or greater than the number of attestors.
    /// * Panics with `Error::DuplicateAttestor` if the attestor list contains duplicate addresses.
    #[allow(clippy::too_many_arguments)]""")

l = l.replace("""<<<<<<< HEAD
        attestors: Vec<Address>,
        threshold: u32,
        template: Option<TemplateType>,
=======
        resolver_address: Address,
>>>>>>> origin/main""", """        attestors: soroban_sdk::Vec<Address>,
        threshold: u32,
        template: Option<TemplateType>,
        resolver_address: Address,""")

l = l.replace("""<<<<<<< HEAD
            attestors,
            threshold,
            template,
=======
            resolver_address,
>>>>>>> origin/main""", """            attestors,
            threshold,
            template,
            resolver_address,""")

l = l.replace("""<<<<<<< HEAD
    /// Casts an attestor vote on an M-of-N commitment, tallying it securely.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be one of the
    ///   commitment's assigned `attestors`.
    /// * Why: Only assigned attestors are permitted to vote on the commitment's outcome.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The attestor casting the vote. Must authorize the call.
    /// * `id` - The unique identifier of the commitment.
    /// * `outcome` - The attested outcome (`Fulfilled`, `Late`, or `Breached`).
    ///
    /// # Panics
    /// * Panics with `Error::NotAttestor` if `caller` is not an assigned attestor.
    /// * Panics with `Error::AlreadyVoted` if the attestor has already voted.
    /// * Panics with `Error::VotingClosed` if the vote is cast after `due_at + timeout`.
    /// * Panics with `Error::InvalidOutcome` if `outcome` is `Pending` or `Disputed`.
    /// * Panics with `Error::AlreadyResolved` if the commitment is no longer `Pending`.
    pub fn cast_attestor_vote(env: Env, caller: Address, id: u64, outcome: CommitmentStatus) {
        voting::cast_attestor_vote(&env, caller, id, outcome);
    }

    /// Resolves an M-of-N commitment to the predefined fallback state if the vote
    /// threshold was not reached by `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`.
    ///
    /// Callable by anyone so a stalled commitment can always be unblocked,
    /// preventing locked funds/state.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    ///
    /// # Panics
    /// * Panics with `Error::VotesNotMet` if called before the deadline has elapsed.
    /// * Panics with `Error::AlreadyResolved` if the commitment is no longer `Pending`.
    pub fn finalize_commitment(env: Env, id: u64) {
        voting::finalize_commitment(&env, id);
    }

    /// Returns the running vote tally for an M-of-N commitment.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    ///
    /// # Returns
    /// * `VoteTally` - The per-outcome vote counts (`fulfilled`, `late`, `breached`).
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    pub fn get_vote_tally(env: Env, id: u64) -> VoteTally {
        voting::get_vote_tally(&env, id)
    }

    /// Checks whether an M-of-N commitment can be finalized to its fallback state
    /// (the timeout has elapsed and the threshold was not met).
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    ///
    /// # Returns
    /// * `bool` - True if the fallback timeout has elapsed with the threshold unmet.
    pub fn can_finalize_commitment(env: Env, id: u64) -> bool {
        voting::can_finalize_commitment(&env, id)
    }

=======
>>>>>>> origin/main""", """    /// Casts an attestor vote on an M-of-N commitment, tallying it securely.
    ///
    /// # Authorization
    /// * Authorized caller: `caller` (via `require_auth`), which must be one of the
    ///   commitment's assigned `attestors`.
    /// * Why: Only assigned attestors are permitted to vote on the commitment's outcome.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `caller` - The attestor casting the vote. Must authorize the call.
    /// * `id` - The unique identifier of the commitment.
    /// * `outcome` - The attested outcome (`Fulfilled`, `Late`, or `Breached`).
    ///
    /// # Panics
    /// * Panics with `Error::NotAttestor` if `caller` is not an assigned attestor.
    /// * Panics with `Error::AlreadyVoted` if the attestor has already voted.
    /// * Panics with `Error::VotingClosed` if the vote is cast after `due_at + timeout`.
    /// * Panics with `Error::InvalidOutcome` if `outcome` is `Pending` or `Disputed`.
    /// * Panics with `Error::AlreadyResolved` if the commitment is no longer `Pending`.
    pub fn cast_attestor_vote(env: Env, caller: Address, id: u64, outcome: CommitmentStatus) {
        voting::cast_attestor_vote(&env, caller, id, outcome);
    }

    /// Resolves an M-of-N commitment to the predefined fallback state if the vote
    /// threshold was not reached by `due_at + ATTESTOR_VOTE_TIMEOUT_SECONDS`.
    ///
    /// Callable by anyone so a stalled commitment can always be unblocked,
    /// preventing locked funds/state.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    ///
    /// # Panics
    /// * Panics with `Error::VotesNotMet` if called before the deadline has elapsed.
    /// * Panics with `Error::AlreadyResolved` if the commitment is no longer `Pending`.
    pub fn finalize_commitment(env: Env, id: u64) {
        voting::finalize_commitment(&env, id);
    }

    /// Returns the running vote tally for an M-of-N commitment.
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    ///
    /// # Returns
    /// * `VoteTally` - The per-outcome vote counts (`fulfilled`, `late`, `breached`).
    ///
    /// # Panics
    /// * Panics with `Error::CommitmentNotFound` if the commitment does not exist.
    pub fn get_vote_tally(env: Env, id: u64) -> VoteTally {
        voting::get_vote_tally(&env, id)
    }

    /// Checks whether an M-of-N commitment can be finalized to its fallback state
    /// (the timeout has elapsed and the threshold was not met).
    ///
    /// # Arguments
    /// * `env` - The Soroban execution environment.
    /// * `id` - The unique identifier of the commitment.
    ///
    /// # Returns
    /// * `bool` - True if the fallback timeout has elapsed with the threshold unmet.
    pub fn can_finalize_commitment(env: Env, id: u64) -> bool {
        voting::can_finalize_commitment(&env, id)
    }""")
with open('contracts/registry/src/lib.rs', 'w') as f:
    f.write(l)

# Fix test.rs
with open('contracts/registry/src/test.rs', 'r') as f:
    t = f.read()

t = t.replace("""<<<<<<< HEAD
#![allow(clippy::bool_assert_comparison)]
=======
>>>>>>> origin/main""", "#![allow(clippy::bool_assert_comparison)]")

# Now we have 58 occurrences of create_commitment in test.rs. 
# A regex search and replace will handle it correctly, bypassing all the Git conflict markers, 
# or we can simply replace the git conflict blocks!

def fix_test_conflict(match):
    # The conflict block looks like:
    # <<<<<<< HEAD
    #     let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at, &Vec::new(&env), &0, &None);
    # =======
    #     let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at, &resolver);
    # >>>>>>> origin/main
    # We want to replace it with:
    #     let id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at, &soroban_sdk::Vec::new(&env), &0, &None, &resolver);
    
    head_content = match.group(1)
    main_content = match.group(2)
    
    # We will just use the python regex to merge the arguments.
    # The easiest is actually to just discard the conflict blocks and do a regex replace on the entire file later!
    # Wait, the conflict blocks are exactly what we want to resolve.
    return match.group(0) # We'll do it a safer way.

# Wait, let's just use `sed` or regex on the whole file to find all `client.create_commitment(` and replace their args.
# Or better yet, we can just run a smart python script.
