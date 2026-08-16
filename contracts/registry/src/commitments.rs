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
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TemplateType {
    Freeform,
    RefundDeposit,
    SLAGuarantee,
    MilestoneCheckIn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OptTemplate(pub Option<TemplateType>);

impl core::ops::Deref for OptTemplate {
    type Target = Option<TemplateType>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl PartialEq<Option<TemplateType>> for OptTemplate {
    fn eq(&self, other: &Option<TemplateType>) -> bool {
        &self.0 == other
    }
}

impl PartialEq<OptTemplate> for Option<TemplateType> {
    fn eq(&self, other: &OptTemplate) -> bool {
        self == &other.0
    }
}

impl soroban_sdk::TryFromVal<soroban_sdk::Env, soroban_sdk::Val> for OptTemplate {
    type Error = soroban_sdk::ConversionError;
    fn try_from_val(env: &soroban_sdk::Env, val: &soroban_sdk::Val) -> Result<Self, soroban_sdk::ConversionError> {
        let opt: Option<TemplateType> = Option::<TemplateType>::try_from_val(env, val)?;
        Ok(OptTemplate(opt))
    }
}

impl soroban_sdk::TryFromVal<soroban_sdk::Env, OptTemplate> for soroban_sdk::Val {
    type Error = soroban_sdk::ConversionError;
    fn try_from_val(env: &soroban_sdk::Env, val: &OptTemplate) -> Result<Self, soroban_sdk::ConversionError> {
        val.0.try_into_val(env)
    }
}

#[cfg(not(target_family = "wasm"))]
impl soroban_sdk::TryFromVal<soroban_sdk::Env, soroban_sdk::xdr::ScVal> for OptTemplate {
    type Error = soroban_sdk::xdr::Error;
    fn try_from_val(env: &soroban_sdk::Env, val: &soroban_sdk::xdr::ScVal) -> Result<Self, soroban_sdk::xdr::Error> {
        match val {
            soroban_sdk::xdr::ScVal::Void => Ok(OptTemplate(None)),
            _ => {
                let v: Val = val.try_into_val(env).map_err(|_| soroban_sdk::xdr::Error::Invalid)?;
                let t = TemplateType::try_from_val(env, &v).map_err(|_| soroban_sdk::xdr::Error::Invalid)?;
                Ok(OptTemplate(Some(t)))
            }
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl soroban_sdk::TryFromVal<soroban_sdk::Env, OptTemplate> for soroban_sdk::xdr::ScVal {
    type Error = soroban_sdk::xdr::Error;
    fn try_from_val(_env: &soroban_sdk::Env, val: &OptTemplate) -> Result<Self, soroban_sdk::xdr::Error> {
        match &val.0 {
            Some(t) => {
                let scval: soroban_sdk::xdr::ScVal = (*t).try_into().unwrap();
                Ok(scval)
            }
            None => Ok(soroban_sdk::xdr::ScVal::Void),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl TryFrom<&soroban_sdk::xdr::ScVal> for OptTemplate {
    type Error = soroban_sdk::xdr::Error;
    fn try_from(val: &soroban_sdk::xdr::ScVal) -> Result<Self, soroban_sdk::xdr::Error> {
        match val {
            soroban_sdk::xdr::ScVal::Void => Ok(OptTemplate(None)),
            soroban_sdk::xdr::ScVal::Vec(Some(vec)) => {
                if let Some(soroban_sdk::xdr::ScVal::Symbol(sym)) = vec.first() {
                    let s = core::str::from_utf8(sym.0.as_ref()).map_err(|_| soroban_sdk::xdr::Error::Invalid)?;
                    let t = match s {
                        "Freeform" => TemplateType::Freeform,
                        "RefundDeposit" => TemplateType::RefundDeposit,
                        "SLAGuarantee" => TemplateType::SLAGuarantee,
                        "MilestoneCheckIn" => TemplateType::MilestoneCheckIn,
                        _ => return Err(soroban_sdk::xdr::Error::Invalid),
                    };
                    Ok(OptTemplate(Some(t)))
                } else {
                    Err(soroban_sdk::xdr::Error::Invalid)
                }
            }
            _ => Err(soroban_sdk::xdr::Error::Invalid),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl TryFrom<soroban_sdk::xdr::ScVal> for OptTemplate {
    type Error = soroban_sdk::xdr::Error;
    fn try_from(val: soroban_sdk::xdr::ScVal) -> Result<Self, soroban_sdk::xdr::Error> {
        (&val).try_into()
    }
}

#[cfg(not(target_family = "wasm"))]
impl TryFrom<&OptTemplate> for soroban_sdk::xdr::ScVal {
    type Error = soroban_sdk::xdr::Error;
    fn try_from(val: &OptTemplate) -> Result<Self, soroban_sdk::xdr::Error> {
        match &val.0 {
            Some(t) => Ok((*t).try_into().unwrap()),
            None => Ok(soroban_sdk::xdr::ScVal::Void),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl TryFrom<OptTemplate> for soroban_sdk::xdr::ScVal {
    type Error = soroban_sdk::xdr::Error;
    fn try_from(val: OptTemplate) -> Result<Self, soroban_sdk::xdr::Error> {
        (&val).try_into()
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

    #[derive(arbitrary::Arbitrary, Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
    pub struct ArbitraryOptTemplate(pub Option<ArbitraryTemplateType>);

    impl soroban_sdk::testutils::arbitrary::SorobanArbitrary for OptTemplate {
        type Prototype = ArbitraryOptTemplate;
    }

    impl soroban_sdk::TryFromVal<soroban_sdk::Env, ArbitraryOptTemplate> for OptTemplate {
        type Error = soroban_sdk::ConversionError;
        fn try_from_val(
            _env: &soroban_sdk::Env,
            v: &ArbitraryOptTemplate,
        ) -> Result<Self, Self::Error> {
            let opt = match &v.0 {
                Some(ArbitraryTemplateType::Freeform) => Some(TemplateType::Freeform),
                Some(ArbitraryTemplateType::RefundDeposit) => Some(TemplateType::RefundDeposit),
                Some(ArbitraryTemplateType::SLAGuarantee) => Some(TemplateType::SLAGuarantee),
                Some(ArbitraryTemplateType::MilestoneCheckIn) => Some(TemplateType::MilestoneCheckIn),
                None => None,
            };
            Ok(OptTemplate(opt))
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
    pub template: OptTemplate,
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
        template: OptTemplate(None),
    };

    env.storage()
        .persistent()
        .set(&DataKey::Commitment(id), &migrated);

    Some(migrated)
}
