//! Adaptive Fee Oracle with on-chain PID controller.
//!
//! Recommends fee levels based on observed transaction fee history using a
//! Proportional-Integral-Derivative (PID) feedback loop. All calculations use
//! fixed-point integer arithmetic with fixed scale factor [`SCALE`] = 1,000,000.

use soroban_sdk::{contracttype, Env};

/// Fixed-point scale factor (6 decimal places).
pub const SCALE: i128 = 1_000_000;

/// Proportional gain Kp (scaled). Tune conservatively: 0.1 * SCALE.
pub const KP: i128 = 100_000;

/// Integral gain Ki (scaled). Tune very low to avoid windup: 0.01 * SCALE.
pub const KI: i128 = 10_000;

/// Derivative gain Kd (scaled). Dampen oscillation: 0.05 * SCALE.
pub const KD: i128 = 50_000;

/// Maximum absolute value of the integral accumulator (anti-windup clamp).
pub const INTEGRAL_MAX: i128 = 100 * SCALE;

/// Minimum recommended fee in stroops.
pub const MIN_FEE: i128 = 100;

/// Maximum recommended fee in stroops (100,000 stroops = 0.01 XLM).
pub const MAX_FEE: i128 = 100_000;

/// Default baseline fee target in stroops (10,000 = 0.001 XLM).
pub const BASELINE_FEE: i128 = 10_000;

/// Storage key for the fee oracle state in instance storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OracleKey {
    State,
}

/// On-chain PID controller state for the fee oracle.
/// All values are stored in fixed-point with SCALE = 1_000_000.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleState {
    /// Current recommended fee in stroops (not scaled).
    pub recommended_fee: i128,
    /// Running integral accumulator (scaled by SCALE, clamped to INTEGRAL_MAX).
    pub integral: i128,
    /// Previous error value for derivative calculation (scaled by SCALE).
    pub prev_error: i128,
    /// Last ledger sequence at which the oracle was updated.
    pub last_ledger: u32,
    /// Number of observations recorded so far.
    pub observation_count: u32,
}

/// Loads oracle state from instance storage using `OracleKey::State`.
/// Returns `None` if not yet initialized.
pub fn load_state(env: &Env) -> Option<OracleState> {
    env.storage().instance().get(&OracleKey::State)
}

/// Saves oracle state to instance storage using `OracleKey::State`.
pub fn save_state(env: &Env, state: &OracleState) {
    env.storage().instance().set(&OracleKey::State, state);
    env.storage().instance().extend_ttl(
        crate::commitments::TTL_THRESHOLD_LEDGERS,
        crate::commitments::TTL_EXTEND_LEDGERS,
    );
}

/// Records a new observed fee and updates the PID controller state.
pub fn update_oracle(env: &Env, observed_fee: i128) -> OracleState {
    let mut state = load_state(env).unwrap_or(OracleState {
        recommended_fee: BASELINE_FEE,
        integral: 0,
        prev_error: 0,
        last_ledger: 0,
        observation_count: 0,
    });

    let error = BASELINE_FEE.saturating_sub(observed_fee);
    let new_integral = state
        .integral
        .saturating_add(error)
        .clamp(-INTEGRAL_MAX, INTEGRAL_MAX);
    let derivative = error.saturating_sub(state.prev_error);

    let p_term = KP.saturating_mul(error);
    let i_term = KI.saturating_mul(new_integral);
    let d_term = KD.saturating_mul(derivative);

    let pid_output = p_term.saturating_add(i_term).saturating_add(d_term) / SCALE;

    let new_fee = BASELINE_FEE
        .saturating_add(pid_output)
        .clamp(MIN_FEE, MAX_FEE);

    state.recommended_fee = new_fee;
    state.prev_error = error;
    state.integral = new_integral;
    state.last_ledger = env.ledger().sequence();
    state.observation_count = state.observation_count.saturating_add(1);

    save_state(env, &state);
    state
}

/// Returns the current recommended fee from the PID oracle.
/// Returns `Error::OracleNotInitialized` if no observations have been recorded yet.
pub fn get_recommended_fee(env: &Env) -> Result<i128, crate::errors::Error> {
    let state = load_state(env).ok_or(crate::errors::Error::OracleNotInitialized)?;
    if state.observation_count == 0 {
        return Err(crate::errors::Error::OracleNotInitialized);
    }
    Ok(state.recommended_fee)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RegistryContract;
    use soroban_sdk::Env;

    fn setup() -> (Env, soroban_sdk::Address) {
        let env = Env::default();
        let contract_id = env.register(RegistryContract, ());
        (env, contract_id)
    }

    #[test]
    fn test_oracle_initializes_on_first_update() {
        let (env, contract_id) = setup();
        let state = env.as_contract(&contract_id, || update_oracle(&env, BASELINE_FEE));
        assert_eq!(state.observation_count, 1);
        // Zero error means zero PID output, fee stays at baseline.
        assert_eq!(state.recommended_fee, BASELINE_FEE);
    }

    #[test]
    fn test_oracle_raises_fee_when_observed_low() {
        let (env, contract_id) = setup();
        // Observed fee much lower than baseline → error is positive → fee rises.
        let state = env.as_contract(&contract_id, || update_oracle(&env, MIN_FEE));
        assert!(state.recommended_fee > BASELINE_FEE);
        assert!(state.recommended_fee <= MAX_FEE);
    }

    #[test]
    fn test_oracle_lowers_fee_when_observed_high() {
        let (env, contract_id) = setup();
        // Observed fee much higher than baseline → error is negative → fee drops.
        let state = env.as_contract(&contract_id, || update_oracle(&env, MAX_FEE * 2));
        assert!(state.recommended_fee < BASELINE_FEE);
        assert!(state.recommended_fee >= MIN_FEE);
    }

    #[test]
    fn test_oracle_clamps_to_min_max() {
        let (env, contract_id) = setup();
        // Extreme low observation must never go below MIN_FEE.
        let state = env.as_contract(&contract_id, || update_oracle(&env, 0));
        assert!(state.recommended_fee >= MIN_FEE);
        assert!(state.recommended_fee <= MAX_FEE);
    }

    #[test]
    fn test_get_fee_before_init_returns_error() {
        let (env, contract_id) = setup();
        let result = env.as_contract(&contract_id, || get_recommended_fee(&env));
        assert_eq!(result, Err(crate::errors::Error::OracleNotInitialized));
    }

    #[test]
    fn test_integral_anti_windup() {
        let (env, contract_id) = setup();
        // Repeated extreme low observations: integral must not exceed INTEGRAL_MAX.
        let mut state = env.as_contract(&contract_id, || update_oracle(&env, 0));
        for _ in 0..50 {
            state = env.as_contract(&contract_id, || update_oracle(&env, 0));
        }
        assert!(state.integral <= INTEGRAL_MAX);
        assert!(state.integral >= -INTEGRAL_MAX);
    }

    #[test]
    fn test_client_fee_oracle_flow() {
        let env = Env::default();
        let contract_id = env.register(RegistryContract, ());
        let client = crate::RegistryContractClient::new(&env, &contract_id);

        let state = client.update_fee_oracle(&BASELINE_FEE);
        assert_eq!(state.recommended_fee, BASELINE_FEE);

        let fee = client.get_recommended_fee();
        assert_eq!(fee, BASELINE_FEE);
    }
}
