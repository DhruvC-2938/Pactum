use soroban_sdk::{
    contracttype, panic_with_error, Address, BytesN, Env, Map, Symbol, TryFromVal, TryIntoVal, Val,
    Vec,
};

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
    /// The panel of staked attestors that vote on disputes for this commitment.
    /// An empty panel keeps the commitment on the single-resolver dispute path.
    pub attestors: Vec<Address>,
    /// How many matching attestor votes are required to resolve a dispute.
    /// Must be between 1 and `attestors.len()` when a panel is configured,
    /// and zero when it is not.
    pub vote_threshold: u32,
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
    /// Instance storage key for the set of designated arbitrators.
    ///
    /// A `Vec<Address>` so disputes can be settled by a majority of the
    /// committee instead of a single point of trust.
    ArbitratorSet,
    /// Legacy instance storage key for a single designated arbitrator.
    ///
    /// Only written by pre-multi-arbitrator deployments; read once to lazily
    /// migrate into [`DataKey::ArbitratorSet`].
    Arbitrator,
    /// Instance storage key for the protocol paused (emergency halt) flag.
    Paused,
    /// Persistent storage key for the running vote tally of a disputed
    /// commitment, keyed by commitment ID.
    Votes(u64),
    /// Persistent storage key for an attestor's staking record.
    Stake(Address),
    /// Instance storage key for the address of the staking (vault) token.
    StakingToken,
    /// Persistent storage key for a single attestor's vote on a disputed
    /// commitment, keyed by commitment ID and attestor address.
    VoteRecord(u64, Address),
    /// Persistent storage key for the running vote tally of a disputed
    /// commitment.
    DisputeTally(u64),
}

/// Running tally of arbitrator votes on a single disputed commitment.
///
/// Votes are keyed by voter address so each arbitrator can vote at most once,
/// and the per-outcome counters make the majority check O(1) on every vote
/// rather than scanning prior votes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeVotes {
    /// Votes cast for `Fulfilled`.
    pub fulfilled: u32,
    /// Votes cast for `Late`.
    pub late: u32,
    /// Votes cast for `Breached`.
    pub breached: u32,
    /// Arbitrators that have already voted, mapped to the outcome they chose.
    pub voters: Map<Address, CommitmentStatus>,
}

impl DisputeVotes {
    /// Creates an empty tally for a new dispute.
    pub fn new(env: &Env) -> Self {
        Self {
            fulfilled: 0,
            late: 0,
            breached: 0,
            voters: Map::new(env),
        }
    }

    /// Returns the number of votes currently cast for `outcome`.
    pub fn count(&self, outcome: CommitmentStatus) -> u32 {
        match outcome {
            CommitmentStatus::Fulfilled => self.fulfilled,
            CommitmentStatus::Late => self.late,
            CommitmentStatus::Breached => self.breached,
            // Pending / Disputed are rejected before a vote is ever recorded.
            _ => 0,
        }
    }

    /// Records one vote for `outcome` by `voter`.
    ///
    /// Callers must check [`DisputeVotes::voters`] for an existing vote first;
    /// this method does not guard against double voting.
    pub fn record(&mut self, voter: &Address, outcome: CommitmentStatus) {
        self.voters.set(voter.clone(), outcome);
        match outcome {
            CommitmentStatus::Fulfilled => self.fulfilled = self.fulfilled.saturating_add(1),
            CommitmentStatus::Late => self.late = self.late.saturating_add(1),
            CommitmentStatus::Breached => self.breached = self.breached.saturating_add(1),
            _ => {}
        }
    }
}

/// Loads the arbitrator set, panicking with [`crate::errors::Error::NotInitialized`]
/// if the contract has not been initialized.
///
/// Lazily migrates a pre-multi-arbitrator deployment: a contract initialized
/// under the old single-arbitrator model stored a bare `Address` under
/// [`DataKey::Arbitrator`]. It is wrapped into a one-member set and persisted
/// on first read, mirroring the lazy-migration pattern used for commitments
/// and reputation rows.
pub fn arbitrators(env: &Env) -> Vec<Address> {
    if let Some(set) = env
        .storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::ArbitratorSet)
    {
        return set;
    }

    let legacy: Address = env
        .storage()
        .instance()
        .get(&DataKey::Arbitrator)
        .unwrap_or_else(|| panic_with_error!(env, crate::errors::Error::NotInitialized));

    let set = soroban_sdk::vec![env, legacy];
    env.storage().instance().set(&DataKey::ArbitratorSet, &set);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
    set
}

/// Loads a commitment from persistent storage, transparently migrating legacy records
/// that were stored before `resolver_address` or the milestone counters were added.
/// Legacy records inherit the contract's designated arbitrator address as their
/// fallback `resolver_address`, and become single-milestone commitments whose
/// milestone is already attested if the record was resolved.
pub fn get_commitment_record(env: &soroban_sdk::Env, id: u64) -> Option<Commitment> {
    let val: Val = env.storage().persistent().get(&DataKey::Commitment(id))?;

    let map = Map::<Symbol, Val>::try_from_val(env, &val).ok()?;
    let resolver_sym = Symbol::new(env, "resolver_address");
    let milestone_sym = Symbol::new(env, "milestone_count");
    let attestors_sym = Symbol::new(env, "attestors");
    let threshold_sym = Symbol::new(env, "vote_threshold");

    if map.contains_key(resolver_sym.clone())
        && map.contains_key(milestone_sym)
        && map.contains_key(attestors_sym)
        && map.contains_key(threshold_sym)
    {
        return Commitment::try_from_val(env, &val).ok();
    }

    // Legacy record: parse the fields it does carry and fill in the rest.
    let stored_id: u64 = map.get(Symbol::new(env, "id"))?.try_into_val(env).ok()?;
    if stored_id != id {
        return None;
    }
    let issuer: Address = map
        .get(Symbol::new(env, "issuer"))?
        .try_into_val(env)
        .ok()?;
    let counterparty: Address = map
        .get(Symbol::new(env, "counterparty"))?
        .try_into_val(env)
        .ok()?;
    let terms_hash: BytesN<32> = map
        .get(Symbol::new(env, "terms_hash"))?
        .try_into_val(env)
        .ok()?;
    let due_at: u64 = map
        .get(Symbol::new(env, "due_at"))?
        .try_into_val(env)
        .ok()?;
    let status: CommitmentStatus = map
        .get(Symbol::new(env, "status"))?
        .try_into_val(env)
        .ok()?;
    let created_at: u64 = map
        .get(Symbol::new(env, "created_at"))?
        .try_into_val(env)
        .ok()?;
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
        // Pre-resolver record: fall back to the first member of the arbitrator
        // set. Naming an arbitrator as the resolver routes the dispute through
        // the committee's majority vote, exactly like a fresh commitment that
        // delegates to the committee.
        None => arbitrators(env).first().unwrap_or_else(|| {
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
        // A legacy record predates attestor voting: it has no panel and stays
        // on the single-resolver dispute path.
        attestors: Vec::new(env),
        vote_threshold: 0,
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
    attestors: Vec<Address>,
    vote_threshold: u32,
) -> u64 {
    // 0. Enter the reentrancy guard before any external interaction (including
    //    the require_auth call below, which may invoke a custom account contract).
    crate::reentrancy::enter(env);

    // 1. Require authorization from the issuer.
    issuer.require_auth();

    // 2. Validate parameters using shared validation rules.
    let now = env.ledger().timestamp();
    if let Err(err) = pactum_validation::validate_commitment_creation(due_at, now, milestone_count) {
        match err {
            pactum_validation::ValidationError::DueAtInPast => {
                soroban_sdk::panic_with_error!(env, crate::errors::Error::DueAtInPast);
            }
            pactum_validation::ValidationError::InvalidMilestoneCount => {
                soroban_sdk::panic_with_error!(env, crate::errors::Error::InvalidMilestoneCount);
            }
        }
    }

    // 4. Validate the attestor voting panel: a threshold is only meaningful
    //    together with a non-empty panel, and must not exceed the panel size.
    let has_panel = !attestors.is_empty();
    if has_panel != (vote_threshold > 0) || vote_threshold > attestors.len() {
        soroban_sdk::panic_with_error!(env, crate::errors::Error::ThresholdInvalid);
    }

    // 5. Assign the next available ID.
    let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
    let next_id = id
        .checked_add(1)
        .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, crate::errors::Error::Overflow));
    env.storage().instance().set(&DataKey::NextId, &next_id);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);

    // 6. Create the Commitment object with Pending status.
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
        attestors,
        vote_threshold,
    };

    // 7. Store in persistent storage keyed by id and extend TTL.
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &commitment);
    env.storage().persistent().extend_ttl(
        &DataKey::Commitment(id),
        TTL_THRESHOLD_LEDGERS,
        TTL_EXTEND_LEDGERS,
    );

    // 8. Emit Created event.
    crate::events::commitment_created(
        env,
        id,
        &issuer,
        &counterparty,
        &commitment.oracle,
        commitment.schema_id,
    );

    // 9. Release the reentrancy guard.
    crate::reentrancy::exit(env);

    id
}
