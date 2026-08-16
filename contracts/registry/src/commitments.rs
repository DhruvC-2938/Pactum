extern crate alloc;

use soroban_sdk::{contracttype, Address, BytesN, Map, Symbol, TryFromVal, TryIntoVal, Val};

/// The default dispute window in seconds (7 days = 604,800 seconds).
/// A party may raise a dispute within this duration after an attestation occurs.
pub const DISPUTE_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;

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

/// Classifies the type of a Commitment for machine-readable tooling.
/// `Freeform` preserves full backward compatibility with existing commitments
/// that have no template; all other variants require a matching off-chain
/// JSON schema hashed into `terms_hash`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TemplateType {
    /// Current behavior — no schema constraint on terms_hash.
    Freeform,
    /// Rental or payment deposit with a defined refund condition.
    RefundDeposit,
    /// Service-level agreement with uptime/response-time guarantees.
    SLAGuarantee,
    /// Milestone-based check-in for a project deliverable.
    MilestoneCheckIn,
}

impl soroban_sdk::TryFromVal<soroban_sdk::Env, soroban_sdk::Val> for TemplateType {
    type Error = soroban_sdk::ConversionError;
    #[inline(always)]
    fn try_from_val(env: &soroban_sdk::Env, val: &soroban_sdk::Val) -> Result<Self, Self::Error> {
        use soroban_sdk::{EnvBase, TryIntoVal};
        const CASES: &[&str] = &[
            "Freeform",
            "RefundDeposit",
            "SLAGuarantee",
            "MilestoneCheckIn",
        ];
        let vec: soroban_sdk::Vec<soroban_sdk::Val> = val.try_into_val(env)?;
        let mut iter = vec.try_iter();
        let discriminant: soroban_sdk::Symbol = iter
            .next()
            .ok_or(soroban_sdk::ConversionError)??
            .try_into_val(env)
            .map_err(|_| soroban_sdk::ConversionError)?;
        let idx = env.symbol_index_in_strs(discriminant.to_symbol_val(), CASES)?;
        Ok(match u32::from(idx) as usize {
            0 => {
                if iter.len() > 0 {
                    return Err(soroban_sdk::ConversionError);
                }
                Self::Freeform
            }
            1 => {
                if iter.len() > 0 {
                    return Err(soroban_sdk::ConversionError);
                }
                Self::RefundDeposit
            }
            2 => {
                if iter.len() > 0 {
                    return Err(soroban_sdk::ConversionError);
                }
                Self::SLAGuarantee
            }
            3 => {
                if iter.len() > 0 {
                    return Err(soroban_sdk::ConversionError);
                }
                Self::MilestoneCheckIn
            }
            _ => return Err(soroban_sdk::ConversionError),
        })
    }
}

impl soroban_sdk::TryFromVal<soroban_sdk::Env, TemplateType> for soroban_sdk::Val {
    type Error = soroban_sdk::ConversionError;
    #[inline(always)]
    fn try_from_val(env: &soroban_sdk::Env, val: &TemplateType) -> Result<Self, Self::Error> {
        use soroban_sdk::{IntoVal, TryIntoVal};
        let mut vec = soroban_sdk::Vec::<soroban_sdk::Val>::new(env);
        match val {
            TemplateType::Freeform => {
                vec.push_back(soroban_sdk::Symbol::new(env, "Freeform").into_val(env));
            }
            TemplateType::RefundDeposit => {
                vec.push_back(soroban_sdk::Symbol::new(env, "RefundDeposit").into_val(env));
            }
            TemplateType::SLAGuarantee => {
                vec.push_back(soroban_sdk::Symbol::new(env, "SLAGuarantee").into_val(env));
            }
            TemplateType::MilestoneCheckIn => {
                vec.push_back(soroban_sdk::Symbol::new(env, "MilestoneCheckIn").into_val(env));
            }
        }
        vec.try_into_val(env)
    }
}

impl From<TemplateType> for soroban_sdk::xdr::ScVal {
    fn from(val: TemplateType) -> Self {
        (&val).into()
    }
}

impl From<&TemplateType> for soroban_sdk::xdr::ScVal {
    fn from(val: &TemplateType) -> Self {
        extern crate alloc;
        let sym = match val {
            TemplateType::Freeform => "Freeform",
            TemplateType::RefundDeposit => "RefundDeposit",
            TemplateType::SLAGuarantee => "SLAGuarantee",
            TemplateType::MilestoneCheckIn => "MilestoneCheckIn",
        };
        let symbol_scval =
            soroban_sdk::xdr::ScVal::Symbol(soroban_sdk::xdr::ScSymbol(sym.try_into().unwrap()));
        soroban_sdk::xdr::ScVal::Vec(Some(soroban_sdk::xdr::ScVec(
            alloc::vec![symbol_scval].try_into().unwrap(),
        )))
    }
}

impl TryFrom<&soroban_sdk::xdr::ScVal> for TemplateType {
    type Error = soroban_sdk::xdr::Error;
    fn try_from(val: &soroban_sdk::xdr::ScVal) -> Result<Self, Self::Error> {
        if let soroban_sdk::xdr::ScVal::Vec(Some(vec)) = val {
            if let Some(soroban_sdk::xdr::ScVal::Symbol(sym)) = vec.first() {
                use alloc::string::ToString;
                let s = sym.to_string();
                return match s.as_str() {
                    "Freeform" => Ok(TemplateType::Freeform),
                    "RefundDeposit" => Ok(TemplateType::RefundDeposit),
                    "SLAGuarantee" => Ok(TemplateType::SLAGuarantee),
                    "MilestoneCheckIn" => Ok(TemplateType::MilestoneCheckIn),
                    _ => Err(soroban_sdk::xdr::Error::Invalid),
                };
            }
        }
        Err(soroban_sdk::xdr::Error::Invalid)
    }
}

impl TryFrom<soroban_sdk::xdr::ScVal> for TemplateType {
    type Error = soroban_sdk::xdr::Error;
    fn try_from(val: soroban_sdk::xdr::ScVal) -> Result<Self, Self::Error> {
        (&val).try_into()
    }
}

impl soroban_sdk::TryFromVal<soroban_sdk::Env, soroban_sdk::xdr::ScVal> for TemplateType {
    type Error = soroban_sdk::xdr::Error;
    #[inline(always)]
    fn try_from_val(
        _env: &soroban_sdk::Env,
        val: &soroban_sdk::xdr::ScVal,
    ) -> Result<Self, Self::Error> {
        val.try_into()
    }
}

#[cfg(not(target_family = "wasm"))]
const _: () = {
    use soroban_sdk::testutils::arbitrary::arbitrary;
    use soroban_sdk::testutils::arbitrary::std;

    #[derive(arbitrary::Arbitrary, Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
    pub enum ArbitraryTemplateType {
        Freeform,
        RefundDeposit,
        SLAGuarantee,
        MilestoneCheckIn,
    }

    impl soroban_sdk::testutils::arbitrary::SorobanArbitrary for TemplateType {
        type Prototype = ArbitraryTemplateType;
    }

    impl soroban_sdk::TryFromVal<soroban_sdk::Env, ArbitraryTemplateType> for TemplateType {
        type Error = soroban_sdk::ConversionError;
        fn try_from_val(
            _env: &soroban_sdk::Env,
            v: &ArbitraryTemplateType,
        ) -> Result<Self, Self::Error> {
            Ok(match v {
                ArbitraryTemplateType::Freeform => TemplateType::Freeform,
                ArbitraryTemplateType::RefundDeposit => TemplateType::RefundDeposit,
                ArbitraryTemplateType::SLAGuarantee => TemplateType::SLAGuarantee,
                ArbitraryTemplateType::MilestoneCheckIn => TemplateType::MilestoneCheckIn,
            })
        }
    }
};

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
    /// The address of the custom resolver delegated to resolve disputes for this commitment.
    pub resolver_address: Address,
    /// Optional template type classifying this commitment for tooling.
    pub template: Option<TemplateType>,
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
}

/// Storage keys used for persisting commitments and contract state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Persistent storage key for a Commitment by its unique ID.
    Commitment(u64),
    /// Instance storage key for the incrementing counter of IDs.
    NextId,
    /// Instance storage key for the designated Arbitrator address.
    Arbitrator,
}

/// Loads a commitment from persistent storage, transparently migrating legacy records
/// that were stored before `resolver_address` was added. Legacy records inherit the
/// contract's designated arbitrator address as their fallback `resolver_address`.
pub fn get_commitment_record(env: &soroban_sdk::Env, id: u64) -> Option<Commitment> {
    let val: Val = env.storage().persistent().get(&DataKey::Commitment(id))?;

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

    let fallback_resolver = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Arbitrator)
        .unwrap_or_else(|| {
            soroban_sdk::panic_with_error!(env, crate::errors::Error::NotInitialized)
        });

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
        template: None,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &migrated);

    Some(migrated)
}
