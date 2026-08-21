extern crate alloc;

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec;

use super::codec::{
    deserialize_expr, deserialize_rule_set, serialize_expr, serialize_rule_set, BinaryReader,
    BinaryWriter,
};
use super::eval::{EvalError, Evaluator};
use super::gas::{GasError, GasMeter};
use super::types::{CompareOp, EvalContext, Expr, FnName, Rule, RuleSet, RuntimeValue};

#[test]
fn test_runtime_value_equality_and_truthiness() {
    assert!(!RuntimeValue::Null.is_truthy());
    assert!(!RuntimeValue::Bool(false).is_truthy());
    assert!(RuntimeValue::Bool(true).is_truthy());
    assert!(!RuntimeValue::Num(0.0).is_truthy());
    assert!(!RuntimeValue::Num(f64::NAN).is_truthy());
    assert!(RuntimeValue::Num(42.0).is_truthy());
    assert!(!RuntimeValue::Str(String::new()).is_truthy());
    assert!(RuntimeValue::Str(String::from("hello")).is_truthy());

    assert!(RuntimeValue::Null.strict_eq(&RuntimeValue::Null));
    assert!(RuntimeValue::Bool(true).strict_eq(&RuntimeValue::Bool(true)));
    assert!(!RuntimeValue::Bool(true).strict_eq(&RuntimeValue::Bool(false)));
    assert!(!RuntimeValue::Num(f64::NAN).strict_eq(&RuntimeValue::Num(f64::NAN)));
    assert!(RuntimeValue::Num(100.0).strict_eq(&RuntimeValue::Num(100.0)));
}

#[test]
fn test_binary_codec_expr_roundtrip() {
    let expr = Expr::Compare {
        op: CompareOp::Gte,
        left: Box::new(Expr::Field {
            name: String::from("amount"),
        }),
        right: Box::new(Expr::Lit {
            value: RuntimeValue::Num(500.0),
        }),
    };

    let mut writer = BinaryWriter::new();
    serialize_expr(&expr, &mut writer);
    let bytes = writer.finish();

    let mut reader = BinaryReader::new(&bytes);
    let decoded = deserialize_expr(&mut reader).expect("decoding failed");
    assert_eq!(expr, decoded);
}

#[test]
fn test_binary_codec_rule_set_roundtrip() {
    let rule_set = RuleSet {
        version: 1,
        rules: vec![
            Rule {
                field: String::from("amount"),
                message: String::from("Amount must be at least 100"),
                id: Some(String::from("rule_min_amount")),
                assert: Expr::Compare {
                    op: CompareOp::Gte,
                    left: Box::new(Expr::Field {
                        name: String::from("amount"),
                    }),
                    right: Box::new(Expr::Lit {
                        value: RuntimeValue::Num(100.0),
                    }),
                },
                when: Some(Expr::Lit {
                    value: RuntimeValue::Bool(true),
                }),
            },
            Rule {
                field: String::from("due_date"),
                message: String::from("Due date must be in future"),
                id: None,
                assert: Expr::Compare {
                    op: CompareOp::Gt,
                    left: Box::new(Expr::Field {
                        name: String::from("due_date"),
                    }),
                    right: Box::new(Expr::Call {
                        fn_name: FnName::Now,
                        args: vec![],
                    }),
                },
                when: None,
            },
        ],
    };

    let encoded = serialize_rule_set(&rule_set);
    let decoded = deserialize_rule_set(&encoded).expect("deserialization failed");
    assert_eq!(rule_set, decoded);
}

#[test]
fn test_evaluator_basic_rules() {
    let mut context = EvalContext::new(1700000000000.0);
    context
        .values
        .insert(String::from("amount"), serde_json::json!(250));
    context
        .values
        .insert(String::from("due_date"), serde_json::json!(1800000000000.0));

    let rule_set = RuleSet {
        version: 1,
        rules: vec![
            Rule {
                field: String::from("amount"),
                message: String::from("Amount too low"),
                id: Some(String::from("r1")),
                assert: Expr::Compare {
                    op: CompareOp::Gte,
                    left: Box::new(Expr::Field {
                        name: String::from("amount"),
                    }),
                    right: Box::new(Expr::Lit {
                        value: RuntimeValue::Num(100.0),
                    }),
                },
                when: None,
            },
            Rule {
                field: String::from("due_date"),
                message: String::from("Due date in past"),
                id: Some(String::from("r2")),
                assert: Expr::Compare {
                    op: CompareOp::Gt,
                    left: Box::new(Expr::Field {
                        name: String::from("due_date"),
                    }),
                    right: Box::new(Expr::Call {
                        fn_name: FnName::Now,
                        args: vec![],
                    }),
                },
                when: None,
            },
        ],
    };

    let meter = GasMeter::new(10_000);
    let mut evaluator = Evaluator::new(&context, meter, true);
    let trace = evaluator.eval_rule_set(&rule_set).expect("eval failed");

    assert!(trace.valid);
    assert_eq!(trace.rules_passed, 2);
    assert_eq!(trace.rules_failed, 0);
    assert!(!trace.trace_hash.is_empty());
}

#[test]
fn test_evaluator_gas_exhaustion() {
    let context = EvalContext::new(1700000000000.0);
    let rule_set = RuleSet {
        version: 1,
        rules: vec![Rule {
            field: String::from("test"),
            message: String::from("fail"),
            id: None,
            assert: Expr::And {
                operands: vec![
                    Expr::Lit {
                        value: RuntimeValue::Bool(true),
                    },
                    Expr::Lit {
                        value: RuntimeValue::Bool(true),
                    },
                    Expr::Lit {
                        value: RuntimeValue::Bool(true),
                    },
                ],
            },
            when: None,
        }],
    };

    // Very low gas limit (e.g. 2 units)
    let meter = GasMeter::new(2);
    let mut evaluator = Evaluator::new(&context, meter, false);
    let result = evaluator.eval_rule_set(&rule_set);

    match result {
        Err(EvalError::Gas(GasError::GasExhausted { .. })) => {
            // Expected gas exhaustion
        }
        _ => panic!("Expected gas exhaustion, got {:?}", result),
    }
}

#[test]
fn test_trace_hash_reproducibility() {
    let mut context = EvalContext::new(1000.0);
    context
        .values
        .insert(String::from("status"), serde_json::json!("ACTIVE"));

    let rule_set = RuleSet {
        version: 1,
        rules: vec![Rule {
            field: String::from("status"),
            message: String::from("Status must be ACTIVE"),
            id: Some(String::from("status_check")),
            assert: Expr::In {
                value: Box::new(Expr::Field {
                    name: String::from("status"),
                }),
                set: vec![
                    Expr::Lit {
                        value: RuntimeValue::Str(String::from("ACTIVE")),
                    },
                    Expr::Lit {
                        value: RuntimeValue::Str(String::from("PENDING")),
                    },
                ],
            },
            when: None,
        }],
    };

    let mut eval1 = Evaluator::new(&context, GasMeter::new(10_000), true);
    let trace1 = eval1.eval_rule_set(&rule_set).unwrap();

    let mut eval2 = Evaluator::new(&context, GasMeter::new(10_000), true);
    let trace2 = eval2.eval_rule_set(&rule_set).unwrap();

    assert_eq!(trace1.trace_hash, trace2.trace_hash);
    assert_eq!(trace1.total_gas_used, trace2.total_gas_used);
}

#[test]
fn test_evaluator_nested_field_lookup_and_pollution_guard() {
    let mut context = EvalContext::new(1000.0);
    let mut nested = BTreeMap::new();
    nested.insert(String::from("rate"), serde_json::json!(0.05));
    context
        .values
        .insert(String::from("config"), serde_json::json!(nested));

    assert_eq!(
        context.get_field_value("config.rate"),
        RuntimeValue::Num(0.05)
    );
    assert_eq!(
        context.get_field_value("config.__proto__.polluted"),
        RuntimeValue::Null
    );
    assert_eq!(
        context.get_field_value("constructor.prototype"),
        RuntimeValue::Null
    );
}
