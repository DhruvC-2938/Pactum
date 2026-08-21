extern crate alloc;

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use wasm_bindgen::prelude::*;

use super::codec::{deserialize_rule_set, serialize_rule_set};
use super::eval::Evaluator;
use super::gas::{GasMeter, DEFAULT_GAS_LIMIT};
use super::trace::ExecutionTrace;
use super::types::{EvalContext, RuleSet};

#[wasm_bindgen]
pub fn evaluate_ast_binary(
    rule_set_bytes: &[u8],
    context_json: &str,
    gas_limit: Option<f64>,
    record_steps: Option<bool>,
) -> Result<JsValue, JsValue> {
    let rule_set = deserialize_rule_set(rule_set_bytes)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize binary AST: {:?}", e)))?;

    let context: EvalContext = serde_json::from_str(context_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse context JSON: {}", e)))?;

    let limit = gas_limit.map(|g| g as u64).unwrap_or(DEFAULT_GAS_LIMIT);
    let should_record = record_steps.unwrap_or(false);

    let meter = GasMeter::new(limit);
    let mut evaluator = Evaluator::new(&context, meter, should_record);

    match evaluator.eval_rule_set(&rule_set) {
        Ok(trace) => serde_wasm_bindgen::to_value(&trace)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize trace: {}", e))),
        Err(e) => Err(JsValue::from_str(&format!("AST execution error: {:?}", e))),
    }
}

#[wasm_bindgen]
pub fn evaluate_ast_json(
    rule_set_json: &str,
    context_json: &str,
    gas_limit: Option<f64>,
    record_steps: Option<bool>,
) -> Result<JsValue, JsValue> {
    let rule_set: RuleSet = serde_json::from_str(rule_set_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse rule set JSON: {}", e)))?;

    let context: EvalContext = serde_json::from_str(context_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse context JSON: {}", e)))?;

    let limit = gas_limit.map(|g| g as u64).unwrap_or(DEFAULT_GAS_LIMIT);
    let should_record = record_steps.unwrap_or(false);

    let meter = GasMeter::new(limit);
    let mut evaluator = Evaluator::new(&context, meter, should_record);

    match evaluator.eval_rule_set(&rule_set) {
        Ok(trace) => serde_wasm_bindgen::to_value(&trace)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize trace: {}", e))),
        Err(e) => Err(JsValue::from_str(&format!("AST execution error: {:?}", e))),
    }
}

#[wasm_bindgen]
pub fn serialize_ast_json_to_binary(rule_set_json: &str) -> Result<Vec<u8>, JsValue> {
    let rule_set: RuleSet = serde_json::from_str(rule_set_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse rule set JSON: {}", e)))?;
    Ok(serialize_rule_set(&rule_set))
}

#[wasm_bindgen]
pub fn deserialize_ast_binary_to_json(rule_set_bytes: &[u8]) -> Result<String, JsValue> {
    let rule_set = deserialize_rule_set(rule_set_bytes)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize binary AST: {:?}", e)))?;
    serde_json::to_string(&rule_set)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize rule set JSON: {}", e)))
}

#[wasm_bindgen]
pub fn verify_trace_hash(trace_json: &str) -> Result<bool, JsValue> {
    let trace: ExecutionTrace = serde_json::from_str(trace_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse trace JSON: {}", e)))?;
    let expected = trace.compute_hash();
    Ok(trace.trace_hash == expected)
}
