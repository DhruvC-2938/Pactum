extern crate alloc;

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// The only value types the evaluator produces or compares.
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RuntimeValue {
    #[default]
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
}

impl RuntimeValue {
    /// Truthiness used by and/or/not and rule pass/fail.
    pub fn is_truthy(&self) -> bool {
        match self {
            RuntimeValue::Null => false,
            RuntimeValue::Bool(b) => *b,
            RuntimeValue::Num(n) => *n != 0.0 && !n.is_nan(),
            RuntimeValue::Str(s) => !s.is_empty(),
        }
    }

    /// Converts the runtime value to a string representation.
    pub fn to_string_repr(&self) -> String {
        match self {
            RuntimeValue::Null => String::new(),
            RuntimeValue::Bool(b) => {
                if *b {
                    String::from("true")
                } else {
                    String::from("false")
                }
            }
            RuntimeValue::Num(n) => {
                if n.is_nan() {
                    String::from("NaN")
                } else if n.is_infinite() {
                    if *n > 0.0 {
                        String::from("Infinity")
                    } else {
                        String::from("-Infinity")
                    }
                } else if *n == (*n as i64 as f64) {
                    alloc::format!("{}", *n as i64)
                } else {
                    alloc::format!("{}", n)
                }
            }
            RuntimeValue::Str(s) => s.clone(),
        }
    }

    /// Attempts to parse or convert this value to a finite number (or None).
    pub fn as_number(&self) -> Option<f64> {
        match self {
            RuntimeValue::Null => None,
            RuntimeValue::Bool(_) => None,
            RuntimeValue::Num(n) => {
                if n.is_nan() {
                    None
                } else {
                    Some(*n)
                }
            }
            RuntimeValue::Str(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    trimmed.parse::<f64>().ok().filter(|n| !n.is_nan())
                }
            }
        }
    }

    /// Strict-ish equality matching the JS engine. Differing types are never equal; NaN != NaN.
    pub fn strict_eq(&self, other: &RuntimeValue) -> bool {
        match (self, other) {
            (RuntimeValue::Null, RuntimeValue::Null) => true,
            (RuntimeValue::Bool(a), RuntimeValue::Bool(b)) => a == b,
            (RuntimeValue::Num(a), RuntimeValue::Num(b)) => {
                if a.is_nan() || b.is_nan() {
                    false
                } else {
                    a == b
                }
            }
            (RuntimeValue::Str(a), RuntimeValue::Str(b)) => a == b,
            _ => false,
        }
    }
}

/// Comparison operators. Ordering requires both sides to be the same comparable type.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CompareOp {
    #[serde(rename = "==")]
    Eq = 1,
    #[serde(rename = "!=")]
    Neq = 2,
    #[serde(rename = ">")]
    Gt = 3,
    #[serde(rename = ">=")]
    Gte = 4,
    #[serde(rename = "<")]
    Lt = 5,
    #[serde(rename = "<=")]
    Lte = 6,
}

/// Arithmetic operators evaluated over numbers.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ArithOp {
    #[serde(rename = "+")]
    Add = 1,
    #[serde(rename = "-")]
    Sub = 2,
    #[serde(rename = "*")]
    Mul = 3,
    #[serde(rename = "/")]
    Div = 4,
    #[serde(rename = "%")]
    Mod = 5,
}

/// The whitelist of pure built-in functions.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FnName {
    Now = 1,
    ToNumber = 2,
    ToDate = 3,
    Len = 4,
    Lower = 5,
    Upper = 6,
    Trim = 7,
    IsBlank = 8,
    Abs = 9,
    Days = 10,
    Hours = 11,
}

/// The AST expression node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Expr {
    #[serde(rename = "lit")]
    Lit { value: RuntimeValue },
    #[serde(rename = "field")]
    Field { name: String },
    #[serde(rename = "not")]
    Not { operand: Box<Expr> },
    #[serde(rename = "and")]
    And { operands: Vec<Expr> },
    #[serde(rename = "or")]
    Or { operands: Vec<Expr> },
    #[serde(rename = "compare")]
    Compare {
        op: CompareOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    #[serde(rename = "arith")]
    Arith {
        op: ArithOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    #[serde(rename = "in")]
    In {
        value: Box<Expr>,
        set: Vec<Expr>,
    },
    #[serde(rename = "match")]
    Match {
        value: Box<Expr>,
        pattern: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        flags: Option<String>,
    },
    #[serde(rename = "call")]
    Call {
        #[serde(rename = "fn")]
        fn_name: FnName,
        args: Vec<Expr>,
    },
}

/// A single validation rule.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub field: String,
    pub message: String,
    pub assert: Expr,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<Expr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// A versioned collection of rules.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuleSet {
    pub version: u32,
    pub rules: Vec<Rule>,
}

/// Runtime evaluation context passed to the AST evaluator.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EvalContext {
    pub values: BTreeMap<String, serde_json::Value>,
    pub now: f64,
}

impl EvalContext {
    pub fn new(now: f64) -> Self {
        Self {
            values: BTreeMap::new(),
            now,
        }
    }

    /// Retrieve and normalize a form field value using dotted path segment resolution.
    pub fn get_field_value(&self, path: &str) -> RuntimeValue {
        let segments: Vec<&str> = path.split('.').collect();
        if segments.is_empty() {
            return RuntimeValue::Null;
        }

        // Prevent prototype pollution / reserved segments
        for seg in &segments {
            if *seg == "__proto__" || *seg == "prototype" || *seg == "constructor" || seg.is_empty() {
                return RuntimeValue::Null;
            }
        }

        let first = segments[0];
        let mut current = match self.values.get(first) {
            Some(v) => v,
            None => return RuntimeValue::Null,
        };

        for seg in segments.iter().skip(1) {
            match current {
                serde_json::Value::Object(map) => match map.get(*seg) {
                    Some(next) => current = next,
                    None => return RuntimeValue::Null,
                },
                serde_json::Value::Array(arr) => {
                    if let Ok(idx) = seg.parse::<usize>() {
                        if idx < arr.len() {
                            current = &arr[idx];
                        } else {
                            return RuntimeValue::Null;
                        }
                    } else {
                        return RuntimeValue::Null;
                    }
                }
                _ => return RuntimeValue::Null,
            }
        }

        match current {
            serde_json::Value::Null => RuntimeValue::Null,
            serde_json::Value::Bool(b) => RuntimeValue::Bool(*b),
            serde_json::Value::Number(num) => {
                if let Some(f) = num.as_f64() {
                    RuntimeValue::Num(f)
                } else {
                    RuntimeValue::Null
                }
            }
            serde_json::Value::String(s) => RuntimeValue::Str(s.clone()),
            _ => RuntimeValue::Null,
        }
    }
}
