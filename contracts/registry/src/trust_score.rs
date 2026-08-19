//! Ledger-based time-decay trust scoring (Phase 6).
//!
//! A trust score that weights a breach from years ago equally with a breach
//! from yesterday is flawed, but Soroban has no floating-point math and
//! contracts must stay well under the CPU/read budget. This module computes a
//! 0..=100 trust score from integer math alone, bucketing outcomes by ledger
//! sequence and applying a stepwise decay factor.
//!
//! # Mathematical model
//!
//! Time is divided into fixed buckets of [`BUCKET_SIZE_LEDGERS`] ledgers:
//!
//! ```text
//! bucket(seq) = seq / BUCKET_SIZE_LEDGERS
//! ```
//!
//! Per address, storage holds a single [`TrustHistory`] entry (~52 bytes):
//!
//! - `epoch`: the bucket index of the last write;
//! - `current`: raw (scale-1) outcome counts within bucket `epoch`;
//! - `aged`: fixed-point (scale 2^32) outcome aggregates for every bucket
//!   older than `epoch`, each already decayed to the `epoch` boundary.
//!
//! When a write lands `Δ` buckets after `epoch`, the state is folded once
//! (amortized O(1) per write, never O(N) over history):
//!
//! ```text
//! steps  = min(Δ >> DECAY_SHIFT, MAX_DECAY_STEPS)   // Δ in buckets
//! weight = steps >= 32 ? 0 : SCALE >> steps         // 0 at steps >= 32
//! aged.x = ((aged.x * weight) >> 32) + (current.x * weight) // u128 math
//! current = 0; epoch = now_bucket
//! ```
//!
//! The effective (decayed) value of outcome type `x` at query time is the
//! same fold computed in memory, so `get_trust_score` is a single storage
//! read plus constant integer operations.
//!
//! # Invariants
//!
//! - `epoch` never decreases; bucket deltas use wrapping subtraction (valid
//!   for any realistic Δ; the u32 bucket space spans ~1.3 million years).
//! - Every addition is saturating and every shift is a floor; the release
//!   profile enables `overflow-checks`, so plain arithmetic would panic on
//!   overflow in wasm — saturating/wrapping math is therefore mandatory.
//! - Decay never inflates a weight (floor rounding), and with no new
//!   outcomes all effective values are non-increasing in time, so the score
//!   is monotone non-decreasing as the ledger advances.
//! - Rounding error per fold is at most one unit at scale 2^32 (~2.3e-10 per
//!   outcome), and the fixed-point arithmetic is exact at power-of-two
//!   boundaries, which unit tests assert with exact values.
//! - Deterministic: no randomness, no iteration-order dependence.
//!
//! # Score
//!
//! ```text
//! score = clamp((BASE_SCORE << 32) + FULFILLED_WEIGHT·F
//!               - LATE_WEIGHT·L - BREACH_WEIGHT·B >> 32, 0, 100)
//! ```
//!
//! with `F`/`L`/`B` the effective values at scale 2^32. An address with no
//! history (or with all outcomes fully decayed, `steps = 32` ≈ 3.2 years)
//! scores the [`BASE_SCORE`] baseline of 50.

use crate::commitments::{CommitmentStatus, TTL_EXTEND_LEDGERS, TTL_THRESHOLD_LEDGERS};
use soroban_sdk::{contracttype, Address, Env};

/// Ledgers per outcome bucket (~13.9 hours at ~5s/ledger).
pub const BUCKET_SIZE_LEDGERS: u32 = 10_000;

/// Half-life of an outcome in buckets (64 buckets ≈ 37 days).
pub const DECAY_SHIFT: u32 = 6;

/// Decay steps cap: at 32 steps (2048 buckets ≈ 3.2 years) a weight is 0.
pub const MAX_DECAY_STEPS: u32 = 32;

/// Fixed-point scale for decayed (fractional) outcome weights.
pub const SCALE: u64 = 1 << 32;

/// Baseline trust score for an address with no or fully decayed history.
pub const BASE_SCORE: u32 = 50;

/// Credit applied per effective fulfilled outcome.
pub const FULFILLED_WEIGHT: i128 = 10;

/// Penalty applied per effective late outcome.
pub const LATE_WEIGHT: i128 = 10;

/// Penalty applied per effective breached outcome.
pub const BREACH_WEIGHT: i128 = 50;

/// Aggregated outcome counts for one bucket of history.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutcomeCounts {
    pub fulfilled: u64,
    pub late: u64,
    pub breached: u64,
}

impl OutcomeCounts {
    fn zero() -> Self {
        OutcomeCounts {
            fulfilled: 0,
            late: 0,
            breached: 0,
        }
    }
}

/// Per-address bucketed trust history (one storage entry per address).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustHistory {
    /// Bucket index (ledger sequence / BUCKET_SIZE_LEDGERS) at last write.
    pub epoch: u32,
    /// Raw outcome counts in the current bucket.
    pub current: OutcomeCounts,
    /// Decayed fixed-point (scale 2^32) aggregate of all older buckets.
    pub aged: OutcomeCounts,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrustKey {
    TrustHistory(Address),
}

/// Number of decay steps for a bucket delta (half-life every 64 buckets).
fn decay_steps(delta_buckets: u32) -> u32 {
    let steps = delta_buckets >> DECAY_SHIFT;
    if steps > MAX_DECAY_STEPS {
        MAX_DECAY_STEPS
    } else {
        steps
    }
}

/// Folds the raw `current` bucket into the scaled `aged` aggregate, applying
/// `steps` of decay to both. All math is u128 with a saturating cast back.
fn fold_value(aged: u64, current: u64, steps: u32) -> u64 {
    let a = ((aged as u128) * (decay_weight(steps) as u128)) >> 32;
    let c = (current as u128) * (decay_weight(steps) as u128);
    let sum = a + c;
    if sum > u64::MAX as u128 {
        u64::MAX
    } else {
        sum as u64
    }
}

/// Effective decayed value of an outcome type at scale 2^32, computed in
/// memory (no storage writes).
fn effective_value(aged: u64, current: u64, steps: u32) -> i128 {
    let a = ((aged as i128) * (decay_weight(steps) as i128)) >> 32;
    let c = (current as i128) * (decay_weight(steps) as i128);
    a + c
}

/// Decay weight at scale 2^32 after `steps` half-life steps: 2^(32-steps)
/// (`SCALE >> steps`, which is `1` at exactly 32 steps since `2^32 >> 32 = 1`),
/// floored to exactly 0 at or beyond [`MAX_DECAY_STEPS`], so a fully decayed
/// outcome contributes nothing. The same weight applies to the `aged`
/// aggregate as `(aged * weight) >> 32`, keeping both decay paths consistent:
/// below 32 steps that is exactly `aged >> steps`, at 32 steps it is exactly 0
/// (a plain shift would leave `1` scale unit per outcome forever).
fn decay_weight(steps: u32) -> u64 {
    if steps >= MAX_DECAY_STEPS {
        0
    } else {
        SCALE >> steps
    }
}

/// Records an outcome for `issuer` in the trust history.
///
/// `increment` is true when an outcome is added (attest / dispute resolution)
/// and false when a disputed outcome is retracted. Retraction subtracts from
/// the raw `current` bucket when possible (the dispute window is ~12 buckets,
/// so this is nearly always the case); otherwise it subtracts one scaled unit
/// from the `aged` aggregate, floored at zero.
pub fn update_trust_history(
    env: &Env,
    issuer: Address,
    outcome: CommitmentStatus,
    increment: bool,
) {
    let key = TrustKey::TrustHistory(issuer.clone());
    let now_bucket = env.ledger().sequence() / BUCKET_SIZE_LEDGERS;

    let mut history: TrustHistory = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(TrustHistory {
            epoch: now_bucket,
            current: OutcomeCounts::zero(),
            aged: OutcomeCounts::zero(),
        });

    if now_bucket > history.epoch {
        let steps = decay_steps(now_bucket.wrapping_sub(history.epoch));
        history.aged.fulfilled =
            fold_value(history.aged.fulfilled, history.current.fulfilled, steps);
        history.aged.late = fold_value(history.aged.late, history.current.late, steps);
        history.aged.breached = fold_value(history.aged.breached, history.current.breached, steps);
        history.current = OutcomeCounts::zero();
        history.epoch = now_bucket;
    }

    match outcome {
        CommitmentStatus::Fulfilled => {
            adjust_count(
                &mut history.current.fulfilled,
                &mut history.aged.fulfilled,
                increment,
            );
        }
        CommitmentStatus::Late => {
            adjust_count(&mut history.current.late, &mut history.aged.late, increment);
        }
        CommitmentStatus::Breached => {
            adjust_count(
                &mut history.current.breached,
                &mut history.aged.breached,
                increment,
            );
        }
        _ => {}
    }

    env.storage().persistent().set(&key, &history);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
}

/// Applies a +1 / -1 adjustment to an outcome type, preferring the raw
/// `current` bucket and falling back to one scaled unit of `aged`.
fn adjust_count(current: &mut u64, aged: &mut u64, increment: bool) {
    if increment {
        *current = current.saturating_add(1);
    } else if *current > 0 {
        *current -= 1;
    } else {
        *aged = aged.saturating_sub(SCALE);
    }
}

/// Computes the 0..=100 trust score for `address` as an issuer.
///
/// Read-only: a single storage read plus constant integer math. The only
/// write performed is the TTL extension on an existing entry, mirroring the
/// `get_reputation` bump-on-access pattern so active histories never archive.
///
/// # Returns
/// * `Some(score)` — the score in 0..=100 if a live history entry exists or
///   if the address has never been scored (returns `Some(BASE_SCORE)`).
/// * `None`  — the entry exists in the contract's ledger but is currently
///   **archived** (TTL expired).  The caller should submit a
///   `RestoreFootprint` + `restore_reputation` transaction and retry.
///   Returned as `None` rather than panicking so an integrating contract can
///   handle the missing data safely instead of aborting its own invocation.
///
/// > **Note for direct Soroban callers:** the archived-entry guard is enforced
/// > by the Soroban *host*, not by this function — the host rejects any
/// > invocation whose footprint references an archived key before the Rust code
/// > runs.  This `None` branch is therefore reached only in the SDK test harness
/// > (which does not enforce footprint checks) and serves as a documented signal
/// > that the key is not live.  In production the entry must be present in the
/// > read/write footprint (which the simulating client discovers) or the
/// > transaction is rejected with a `MissingStateEntry` host error before
/// > reaching this contract.
pub fn get_trust_score(env: &Env, address: Address) -> Option<u32> {
    let key = TrustKey::TrustHistory(address);

    // If no entry has ever been written for this address, return the neutral
    // baseline wrapped in Some — the address is simply unscored, not archived.
    let Some(history): Option<TrustHistory> = env.storage().persistent().get(&key) else {
        return Some(BASE_SCORE);
    };

    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);

    let now_bucket = env.ledger().sequence() / BUCKET_SIZE_LEDGERS;
    let steps = decay_steps(now_bucket.wrapping_sub(history.epoch));

    let fulfilled = effective_value(history.aged.fulfilled, history.current.fulfilled, steps);
    let late = effective_value(history.aged.late, history.current.late, steps);
    let breached = effective_value(history.aged.breached, history.current.breached, steps);

    let numerator = ((BASE_SCORE as i128) << 32) + FULFILLED_WEIGHT * fulfilled
        - LATE_WEIGHT * late
        - BREACH_WEIGHT * breached;
    let raw = numerator >> 32;

    let score = if raw <= 0 {
        0
    } else if raw >= 100 {
        100
    } else {
        raw as u32
    };

    Some(score)
}

/// Extends the TTL of `address`'s trust-history entry so it does not archive.
///
/// Permissionless: anyone may call this to keep a dormant address's history
/// alive.  Returns `true` if a live entry was found and extended, `false` if
/// no entry exists (address never scored).
pub fn restore_trust_history(env: &Env, address: Address) -> bool {
    let key = TrustKey::TrustHistory(address);
    if env.storage().persistent().has(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
        true
    } else {
        false
    }
}
