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

fn write_lp_str(hasher: &mut Sha256, s: &str) {
    hasher.update(format!("{}:", s.len()).as_bytes());
    hasher.update(s.as_bytes());
    hasher.update(b"\n");
}

fn write_opt_str(hasher: &mut Sha256, s: Option<&str>) {
    match s {
        Some(val) => {
            hasher.update(b"S");
            write_lp_str(hasher, val);
        }
        None => {
            hasher.update(b"N\n");
        }
    }
}

fn write_runtime_val(hasher: &mut Sha256, val: &RuntimeValue) {
    match val {
        RuntimeValue::Null => hasher.update(b"null\n"),
        RuntimeValue::Bool(b) => hasher.update(format!("bool:{b}\n").as_bytes()),
        RuntimeValue::Num(_) => hasher.update(format!("num:{}\n", val.to_string_repr()).as_bytes()),
        RuntimeValue::Str(s) => {
            hasher.update(b"str:");
            write_lp_str(hasher, s);
        }
    }
}

impl ExecutionTrace {
    /// Constructs a trace and automatically computes its deterministic hash.
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
        hasher.update(format!("gas_limit:{}\n", self.gas_limit).as_bytes());
        hasher.update(format!("instructions:{}\n", self.total_instructions).as_bytes());
        hasher.update(format!("rules_eval:{}\n", self.rules_evaluated).as_bytes());
        hasher.update(format!("rules_pass:{}\n", self.rules_passed).as_bytes());
        hasher.update(format!("rules_fail:{}\n", self.rules_failed).as_bytes());
        hasher.update(format!("rules_count:{}\n", self.rule_results.len()).as_bytes());

        for r in &self.rule_results {
            hasher.update(b"rule:\n");
            write_lp_str(&mut hasher, &r.field);
            write_lp_str(&mut hasher, &r.message);
            write_opt_str(&mut hasher, r.id.as_deref());
            hasher.update(format!("passed:{}\n", r.passed).as_bytes());
            hasher.update(format!("when_eval:{}\n", r.when_evaluated).as_bytes());
            hasher.update(format!("when_pass:{}\n", r.when_passed).as_bytes());
            write_runtime_val(&mut hasher, &r.assert_result);
            hasher.update(format!("gas:{}\n", r.gas_used).as_bytes());
            hasher.update(format!("nodes:{}\n", r.nodes_evaluated).as_bytes());
        }

        hasher.update(format!("steps_count:{}\n", self.steps.len()).as_bytes());
        for s in &self.steps {
            hasher.update(format!("step_idx:{}\n", s.step_index).as_bytes());
            write_lp_str(&mut hasher, &s.node_kind);
            write_lp_str(&mut hasher, &s.detail);
            write_runtime_val(&mut hasher, &s.result);
            hasher.update(format!("step_gas:{}\n", s.gas_used).as_bytes());
        }

        let hash_bytes = hasher.finalize();
        let mut hex = String::with_capacity(64);
        for byte in hash_bytes {
            hex.push_str(&format!("{:02x}", byte));
        }
        hex
    }
}
