extern crate alloc;

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::types::RuntimeValue;

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct TraceStep {
    #[serde(default)]
    pub step_index: u32,
    #[serde(default)]
    pub node_kind: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub result: RuntimeValue,
    #[serde(default)]
    pub gas_used: u64,
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct RuleResult {
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub passed: bool,
    #[serde(default)]
    pub when_evaluated: bool,
    #[serde(default)]
    pub when_passed: bool,
    #[serde(default)]
    pub assert_result: RuntimeValue,
    #[serde(default)]
    pub gas_used: u64,
    #[serde(default)]
    pub nodes_evaluated: u32,
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct ExecutionTrace {
    #[serde(default)]
    pub valid: bool,
    #[serde(default)]
    pub rules_evaluated: u32,
    #[serde(default)]
    pub rules_passed: u32,
    #[serde(default)]
    pub rules_failed: u32,
    #[serde(default)]
    pub total_gas_used: u64,
    #[serde(default)]
    pub gas_limit: u64,
    #[serde(default)]
    pub total_instructions: u64,
    #[serde(default)]
    pub rule_results: Vec<RuleResult>,
    #[serde(default)]
    pub steps: Vec<TraceStep>,
    #[serde(default)]
    pub trace_hash: String,
}

impl ExecutionTrace {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        valid: bool,
        rules_evaluated: u32,
        rules_passed: u32,
        rules_failed: u32,
        total_gas_used: u64,
        gas_limit: u64,
        total_instructions: u64,
        rule_results: Vec<RuleResult>,
        steps: Vec<TraceStep>,
    ) -> Self {
        let mut trace = Self {
            valid,
            rules_evaluated,
            rules_passed,
            rules_failed,
            total_gas_used,
            gas_limit,
            total_instructions,
            rule_results,
            steps,
            trace_hash: String::new(),
        };
        trace.trace_hash = trace.compute_hash();
        trace
    }

    /// Computes deterministic SHA-256 digest over the canonical execution events.
    pub fn compute_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"PACTUM_AST_TRACE_V1\n");
        hasher.update(format!("valid:{}\n", self.valid).as_bytes());
        hasher.update(format!("gas_used:{}\n", self.total_gas_used).as_bytes());
        hasher.update(format!("rules:{}\n", self.rule_results.len()).as_bytes());

        for r in &self.rule_results {
            hasher.update(
                format!(
                    "rule:{}:{}:{}:{}:{}:{}\n",
                    r.field,
                    r.id.as_deref().unwrap_or(""),
                    r.passed,
                    r.when_passed,
                    r.assert_result.to_string_repr(),
                    r.gas_used
                )
                .as_bytes(),
            );
        }

        hasher.update(format!("steps:{}\n", self.steps.len()).as_bytes());
        for s in &self.steps {
            hasher.update(
                format!(
                    "step:{}:{}:{}:{}:{}\n",
                    s.step_index,
                    s.node_kind,
                    s.detail,
                    s.result.to_string_repr(),
                    s.gas_used
                )
                .as_bytes(),
            );
        }

        let hash_bytes = hasher.finalize();
        let mut hex = String::with_capacity(64);
        for byte in hash_bytes {
            hex.push_str(&format!("{:02x}", byte));
        }
        hex
    }
}
