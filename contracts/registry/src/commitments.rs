use soroban_sdk::{contracttype, Address, BytesN, Map, Symbol, TryFromVal, TryIntoVal, Val};

/// The default dispute window in seconds (7 days = 604,800 seconds).
/// A party may raise a dispute within this duration after an attestation occurs.
pub const DISPUTE_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;

/// The threshold in ledgers below which we extend the TTL. (Approx 14 days at 5s/ledger = 241,920)
pub const TTL_THRESHOLD_LEDGERS: u32 = 14 * 17280;

/// The amount in ledgers to extend the TTL to. (Approx 30 days at 5s/ledger = 518,400)
pub const TTL_EXTEND_LEDGERS: u32 = 30 * 17280;

/// The largest number of milestones a single commitment may be split into.
pub const MAX_MILESTONES: u32 = 256;

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
    ///
    /// For a milestone commitment this is the timestamp of the attestation that
    /// resolved the whole commitment, not of an individual milestone.
    pub attested_at: Option<u64>,
    /// The address of the custom resolver delegated to resolve disputes for this commitment.
    pub resolver_address: Address,
    /// How many milestones the commitment is split into. A single-shot
    /// commitment has exactly one.
    pub milestone_count: u32,
    /// How many milestones have been attested so far.
    pub milestones_attested: u32,
    /// How many of the attested milestones came in `Late`.
    pub late_milestones: u32,
    /// Optional designated oracle for automated attestation.
    pub oracle: Option<Address>,
    /// Optional identifier for the schema used to generate terms_hash.
    pub schema_id: Option<u32>,
}

/// Legacy representation of a Commitment prior to custom resolver support.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyCommitment {
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
    /// Optional designated oracle for automated attestation.
    pub oracle: Option<Address>,
    /// Optional identifier for the schema used to generate terms_hash.
    pub schema_id: Option<u32>,
}

/// Storage keys used for persisting commitments and contract state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Persistent storage key for a Commitment by its unique ID.
    Commitment(u64),
    /// Persistent storage key for the attested outcome of a single milestone,
    /// keyed by commitment ID and zero-based milestone index.
    Milestone(u64, u32),
    /// Instance storage key for the incrementing counter of IDs.
    NextId,
    /// Instance storage key for the designated Arbitrator address.
    Arbitrator,
}

/// Loads a commitment from persistent storage, transparently migrating legacy records
/// that were stored before `resolver_address` or the milestone counters were added.
/// Legacy records inherit the contract's designated arbitrator address as their
/// fallback `resolver_address`, and become single-milestone commitments whose
/// milestone is already attested if the record was resolved.
pub fn get_commitment_record(env: &soroban_sdk::Env, id: u64) -> Option<Commitment> {
    let val: Val = env
        .storage()
        .persistent()
        .get(&DataKey::Commitment(id))?;

    let map = Map::<Symbol, Val>::try_from_val(env, &val).ok()?;
    let resolver_sym = Symbol::new(env, "resolver_address");
    let milestone_sym = Symbol::new(env, "milestone_count");

    if map.contains_key(resolver_sym.clone()) && map.contains_key(milestone_sym) {
        return Commitment::try_from_val(env, &val).ok();
    }

    // Legacy record: parse the fields it does carry and fill in the rest.
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
    let oracle: Option<Address> = match map.get(Symbol::new(env, "oracle")) {
        Some(v) => v.try_into_val(env).ok()?,
        None => None,
    };
    let schema_id: Option<u32> = match map.get(Symbol::new(env, "schema_id")) {
        Some(v) => v.try_into_val(env).ok()?,
        None => None,
    };

    let resolver_address: Address = match map.get(resolver_sym) {
        Some(v) => v.try_into_val(env).ok()?,
        // Pre-resolver record: fall back to the contract's arbitrator.
        None => env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Arbitrator)
            .unwrap_or_else(|| {
                soroban_sdk::panic_with_error!(env, crate::errors::Error::NotInitialized)
            }),
    };

    // A pre-milestone record is one milestone, already attested if it resolved.
    let resolved = status != CommitmentStatus::Pending;
    let migrated = Commitment {
        id,
        issuer,
        counterparty,
        terms_hash,
        due_at,
        status,
        created_at,
        attested_at,
        resolver_address,
        milestone_count: 1,
        milestones_attested: if resolved { 1 } else { 0 },
        late_milestones: u32::from(status == CommitmentStatus::Late),
        oracle,
        schema_id,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &migrated);

    Some(migrated)
}

/// Registers a new commitment split into `milestone_count` milestones.
///
/// # Authorization
/// * Authorized caller: `issuer` (via `require_auth`).
/// * Why: Only the party issuing (promising) the commitment should be able to
///   create and bind themselves to a new commitment on-chain.
pub fn create(
    env: &soroban_sdk::Env,
    issuer: Address,
    counterparty: Address,
    terms_hash: BytesN<32>,
    due_at: u64,
    resolver_address: Address,
    milestone_count: u32,
    oracle: Option<Address>,
    schema_id: Option<u32>,
) -> u64 {
    // 0. Enter the reentrancy guard before any external interaction (including
    //    the require_auth call below, which may invoke a custom account contract).
    crate::reentrancy::enter(env);

    // 1. Require authorization from the issuer.
    issuer.require_auth();

    // 2. Validate due_at is in the future relative to the current ledger timestamp.
    let now = env.ledger().timestamp();
    if due_at <= now {
        soroban_sdk::panic_with_error!(env, crate::errors::Error::DueAtInPast);
    }

    // 3. Validate the milestone count.
    if milestone_count == 0 || milestone_count > MAX_MILESTONES {
        soroban_sdk::panic_with_error!(env, crate::errors::Error::InvalidMilestoneCount);
    }

    // 4. Assign the next available ID.
    let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
    let next_id = id.checked_add(1).unwrap_or_else(|| {
        soroban_sdk::panic_with_error!(env, crate::errors::Error::Overflow)
    });
    env.storage().instance().set(&DataKey::NextId, &next_id);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);

    // 5. Create the Commitment object with Pending status.
    let commitment = Commitment {
        id,
        issuer: issuer.clone(),
        counterparty: counterparty.clone(),
        terms_hash,
        due_at,
        status: CommitmentStatus::Pending,
        created_at: now,
        attested_at: None,
        resolver_address,
        milestone_count,
        milestones_attested: 0,
        late_milestones: 0,
        oracle,
        schema_id,
    };

    // 6. Store in persistent storage keyed by id and extend TTL.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &commitment);
    env.storage().persistent().extend_ttl(
        &DataKey::Commitment(id),
        TTL_THRESHOLD_LEDGERS,
        TTL_EXTEND_LEDGERS,
    );

    // 7. Emit Created event.
    crate::events::commitment_created(env, id, &issuer, &counterparty, &commitment.oracle, commitment.schema_id);

    // 8. Release the reentrancy guard.
    crate::reentrancy::exit(env);

    id
}
