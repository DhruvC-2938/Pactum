pub mod codec;
pub mod eval;
pub mod gas;
pub mod trace;
pub mod types;

#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(test)]
mod test;

pub use codec::{deserialize_rule_set, serialize_rule_set};
pub use eval::Evaluator;
pub use gas::GasMeter;
pub use trace::ExecutionTrace;
pub use types::{EvalContext, Expr, Rule, RuleSet, RuntimeValue};

#[cfg(feature = "wasm")]
pub use wasm::*;
