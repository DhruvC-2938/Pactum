extern crate alloc;

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use super::gas::{
    GasError, GasMeter, COST_ARITH, COST_BASE_NODE, COST_CALL_BASE, COST_COMPARE, COST_FIELD_BASE,
    COST_FIELD_SEGMENT, COST_IN_ITEM, COST_LITERAL, COST_LOGIC, COST_REGEX_BASE, COST_STRING_CHAR,
};
use super::trace::{ExecutionTrace, RuleResult, TraceStep};
use super::types::{ArithOp, CompareOp, EvalContext, Expr, FnName, Rule, RuleSet, RuntimeValue};

pub const MAX_MATCH_INPUT_LEN: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalError {
    Gas(GasError),
    General(String),
}

impl From<GasError> for EvalError {
    fn from(err: GasError) -> Self {
        EvalError::Gas(err)
    }
}

pub struct Evaluator<'a> {
    ctx: &'a EvalContext,
    meter: GasMeter,
    steps: Vec<TraceStep>,
    record_steps: bool,
}

impl<'a> Evaluator<'a> {
    pub fn new(ctx: &'a EvalContext, meter: GasMeter, record_steps: bool) -> Self {
        Self {
            ctx,
            meter,
            steps: Vec::new(),
            record_steps,
        }
    }

    pub fn gas_meter(&self) -> &GasMeter {
        &self.meter
    }

    pub fn gas_meter_mut(&mut self) -> &mut GasMeter {
        &mut self.meter
    }

    fn record_step(&mut self, node_kind: &str, detail: &str, result: &RuntimeValue) {
        if self.record_steps {
            let step_index = self.steps.len() as u32;
            self.steps.push(TraceStep {
                step_index,
                node_kind: String::from(node_kind),
                detail: String::from(detail),
                result: result.clone(),
                gas_used: self.meter.used(),
            });
        }
    }

    pub fn eval_expr(&mut self, expr: &Expr) -> Result<RuntimeValue, EvalError> {
        self.meter.consume(COST_BASE_NODE, "visit_node")?;

        let res = match expr {
            Expr::Lit { value } => {
                self.meter.consume(COST_LITERAL, "literal")?;
                let val = value.clone();
                self.record_step("lit", &val.to_string_repr(), &val);
                val
            }
            Expr::Field { name } => {
                let segments_count = name.split('.').count() as u64;
                self.meter.consume(
                    COST_FIELD_BASE
                        .saturating_add(COST_FIELD_SEGMENT.saturating_mul(segments_count)),
                    "field_lookup",
                )?;
                let val = self.ctx.get_field_value(name);
                self.record_step("field", name, &val);
                val
            }
            Expr::Not { operand } => {
                self.meter.consume(COST_LOGIC, "not")?;
                let inner = self.eval_expr(operand)?;
                let val = RuntimeValue::Bool(!inner.is_truthy());
                self.record_step("not", "logical_not", &val);
                val
            }
            Expr::And { operands } => {
                let mut all_truthy = true;
                for op in operands {
                    self.meter.consume(COST_LOGIC, "and_step")?;
                    let val = self.eval_expr(op)?;
                    if !val.is_truthy() {
                        all_truthy = false;
                        break;
                    }
                }
                let val = RuntimeValue::Bool(all_truthy);
                self.record_step("and", "logical_and", &val);
                val
            }
            Expr::Or { operands } => {
                let mut any_truthy = false;
                for op in operands {
                    self.meter.consume(COST_LOGIC, "or_step")?;
                    let val = self.eval_expr(op)?;
                    if val.is_truthy() {
                        any_truthy = true;
                        break;
                    }
                }
                let val = RuntimeValue::Bool(any_truthy);
                self.record_step("or", "logical_or", &val);
                val
            }
            Expr::Compare { op, left, right } => {
                self.meter.consume(COST_COMPARE, "compare")?;
                let l_val = self.eval_expr(left)?;
                let r_val = self.eval_expr(right)?;
                let passed = self.apply_compare(*op, &l_val, &r_val);
                let val = RuntimeValue::Bool(passed);
                self.record_step("compare", &format!("{:?}", op), &val);
                val
            }
            Expr::Arith { op, left, right } => {
                self.meter.consume(COST_ARITH, "arith")?;
                let l_val = self.eval_expr(left)?;
                let r_val = self.eval_expr(right)?;
                let val = self.apply_arith(*op, &l_val, &r_val);
                self.record_step("arith", &format!("{:?}", op), &val);
                val
            }
            Expr::In { value, set } => {
                let target = self.eval_expr(value)?;
                let mut matched = false;
                for item in set {
                    self.meter.consume(COST_IN_ITEM, "in_check")?;
                    let candidate = self.eval_expr(item)?;
                    if target.strict_eq(&candidate) {
                        matched = true;
                        break;
                    }
                }
                let val = RuntimeValue::Bool(matched);
                self.record_step("in", "membership_test", &val);
                val
            }
            Expr::Match {
                value,
                pattern,
                flags,
            } => {
                let target = self.eval_expr(value)?;
                let input_str = target.to_string_repr();
                let cost =
                    COST_REGEX_BASE.saturating_add(((pattern.len() + input_str.len()) / 8) as u64);
                self.meter.consume(cost, "regex_match")?;

                let is_match = if input_str.len() > MAX_MATCH_INPUT_LEN {
                    false
                } else {
                    self.eval_match(&input_str, pattern, flags.as_deref())
                };

                let val = RuntimeValue::Bool(is_match);
                self.record_step("match", pattern, &val);
                val
            }
            Expr::Call { fn_name, args } => {
                self.meter.consume(COST_CALL_BASE, "call_builtin")?;
                let val = self.eval_call(*fn_name, args)?;
                self.record_step("call", &format!("{:?}", fn_name), &val);
                val
            }
        };

        Ok(res)
    }

    fn apply_compare(&self, op: CompareOp, left: &RuntimeValue, right: &RuntimeValue) -> bool {
        match op {
            CompareOp::Eq => left.strict_eq(right),
            CompareOp::Neq => !left.strict_eq(right),
            _ => {
                // Ordering comparison requires identical comparable types
                match (left, right) {
                    (RuntimeValue::Num(a), RuntimeValue::Num(b)) => {
                        if a.is_nan() || b.is_nan() {
                            false
                        } else {
                            match op {
                                CompareOp::Gt => a > b,
                                CompareOp::Gte => a >= b,
                                CompareOp::Lt => a < b,
                                CompareOp::Lte => a <= b,
                                _ => false,
                            }
                        }
                    }
                    (RuntimeValue::Str(a), RuntimeValue::Str(b)) => match op {
                        CompareOp::Gt => a > b,
                        CompareOp::Gte => a >= b,
                        CompareOp::Lt => a < b,
                        CompareOp::Lte => a <= b,
                        _ => false,
                    },
                    _ => false,
                }
            }
        }
    }

    fn apply_arith(&self, op: ArithOp, left: &RuntimeValue, right: &RuntimeValue) -> RuntimeValue {
        let x = match left.as_number() {
            Some(n) => n,
            None => return RuntimeValue::Null,
        };
        let y = match right.as_number() {
            Some(n) => n,
            None => return RuntimeValue::Null,
        };

        let result = match op {
            ArithOp::Add => x + y,
            ArithOp::Sub => x - y,
            ArithOp::Mul => x * y,
            ArithOp::Div => {
                if y == 0.0 {
                    return RuntimeValue::Null;
                }
                x / y
            }
            ArithOp::Mod => {
                if y == 0.0 {
                    return RuntimeValue::Null;
                }
                x % y
            }
        };

        if result.is_nan() {
            RuntimeValue::Null
        } else {
            RuntimeValue::Num(result)
        }
    }

    fn eval_match(&self, input: &str, pattern: &str, flags: Option<&str>) -> bool {
        let case_insensitive = flags.is_some_and(|f| f.contains('i'));

        // Handle alternations e.g. \b(todo|tbd|xxx)\b or (a|b|c)
        let clean_pat = pattern.trim_start_matches('^').trim_end_matches('$');

        if clean_pat.contains('|') {
            let options_str = clean_pat
                .trim_start_matches("\\b")
                .trim_end_matches("\\b")
                .trim_start_matches('(')
                .trim_end_matches(')');
            let options: Vec<&str> = options_str.split('|').collect();
            for opt in options {
                let is_wb = pattern.contains("\\b");
                let single_pat = if is_wb {
                    format!("\\b{}\\b", opt)
                } else {
                    format!(
                        "{}{}{}",
                        if pattern.starts_with('^') { "^" } else { "" },
                        opt,
                        if pattern.ends_with('$') { "$" } else { "" }
                    )
                };
                if self.eval_single_pattern(input, &single_pat, case_insensitive) {
                    return true;
                }
            }
            return false;
        }

        self.eval_single_pattern(input, pattern, case_insensitive)
    }

    fn eval_single_pattern(&self, input: &str, pattern: &str, case_insensitive: bool) -> bool {
        let target = if case_insensitive {
            input.to_lowercase()
        } else {
            String::from(input)
        };
        let mut pat = if case_insensitive {
            pattern.to_lowercase()
        } else {
            String::from(pattern)
        };

        let has_word_boundary_start = pat.starts_with("\\b");
        let has_word_boundary_end = pat.ends_with("\\b");

        let is_start_anchored = pat.starts_with('^');
        let is_end_anchored = pat.ends_with('$');

        pat = String::from(pat.trim_start_matches('^').trim_end_matches('$'));
        if has_word_boundary_start {
            pat = String::from(pat.trim_start_matches("\\b"));
        }
        if has_word_boundary_end {
            pat = String::from(pat.trim_end_matches("\\b"));
        }

        if has_word_boundary_start || has_word_boundary_end {
            let mut start_idx = 0;
            while let Some(pos) = target[start_idx..].find(&pat) {
                let actual_pos = start_idx + pos;
                let left_ok = if has_word_boundary_start {
                    actual_pos == 0 || !target.as_bytes()[actual_pos - 1].is_ascii_alphanumeric()
                } else {
                    true
                };
                let right_pos = actual_pos + pat.len();
                let right_ok = if has_word_boundary_end {
                    right_pos >= target.len()
                        || !target.as_bytes()[right_pos].is_ascii_alphanumeric()
                } else {
                    true
                };
                if left_ok && right_ok {
                    return true;
                }
                start_idx = actual_pos + 1;
                if start_idx >= target.len() {
                    break;
                }
            }
            return false;
        }

        if is_start_anchored && is_end_anchored {
            target == pat
        } else if is_start_anchored {
            target.starts_with(&pat)
        } else if is_end_anchored {
            target.ends_with(&pat)
        } else {
            target.contains(&pat)
        }
    }

    fn eval_call(&mut self, fn_name: FnName, args: &[Expr]) -> Result<RuntimeValue, EvalError> {
        match fn_name {
            FnName::Now => Ok(RuntimeValue::Num(self.ctx.now)),
            FnName::ToNumber => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    match v.as_number() {
                        Some(n) => Ok(RuntimeValue::Num(n)),
                        None => Ok(RuntimeValue::Null),
                    }
                } else {
                    Ok(RuntimeValue::Null)
                }
            }
            FnName::ToDate => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    match v {
                        RuntimeValue::Num(n) => {
                            if n.is_finite() {
                                Ok(RuntimeValue::Num(n))
                            } else {
                                Ok(RuntimeValue::Null)
                            }
                        }
                        RuntimeValue::Str(s) => {
                            // Parse numeric timestamp in string or ISO-8601
                            if let Ok(num) = s.parse::<f64>() {
                                if num.is_finite() {
                                    return Ok(RuntimeValue::Num(num));
                                }
                            }
                            // Basic ISO-8601 date parsing for deterministic epoch ms
                            if let Some(epoch_ms) = parse_iso_date(&s) {
                                Ok(RuntimeValue::Num(epoch_ms))
                            } else {
                                Ok(RuntimeValue::Null)
                            }
                        }
                        _ => Ok(RuntimeValue::Null),
                    }
                } else {
                    Ok(RuntimeValue::Null)
                }
            }
            FnName::Len => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    let len = match &v {
                        RuntimeValue::Null => 0.0,
                        RuntimeValue::Str(s) => s.len() as f64,
                        _ => v.to_string_repr().len() as f64,
                    };
                    Ok(RuntimeValue::Num(len))
                } else {
                    Ok(RuntimeValue::Num(0.0))
                }
            }
            FnName::Lower => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    let s = v.to_string_repr();
                    self.meter.consume(
                        (s.len() as u64).saturating_mul(COST_STRING_CHAR) / 16,
                        "string_lower",
                    )?;
                    Ok(RuntimeValue::Str(s.to_lowercase()))
                } else {
                    Ok(RuntimeValue::Str(String::new()))
                }
            }
            FnName::Upper => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    let s = v.to_string_repr();
                    self.meter.consume(
                        (s.len() as u64).saturating_mul(COST_STRING_CHAR) / 16,
                        "string_upper",
                    )?;
                    Ok(RuntimeValue::Str(s.to_uppercase()))
                } else {
                    Ok(RuntimeValue::Str(String::new()))
                }
            }
            FnName::Trim => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    let s = v.to_string_repr();
                    Ok(RuntimeValue::Str(String::from(s.trim())))
                } else {
                    Ok(RuntimeValue::Str(String::new()))
                }
            }
            FnName::IsBlank => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    let is_blank = match &v {
                        RuntimeValue::Null => true,
                        RuntimeValue::Str(s) => s.trim().is_empty(),
                        _ => v.to_string_repr().trim().is_empty(),
                    };
                    Ok(RuntimeValue::Bool(is_blank))
                } else {
                    Ok(RuntimeValue::Bool(true))
                }
            }
            FnName::Abs => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    match v.as_number() {
                        Some(n) => Ok(RuntimeValue::Num(n.abs())),
                        None => Ok(RuntimeValue::Null),
                    }
                } else {
                    Ok(RuntimeValue::Null)
                }
            }
            FnName::Days => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    match v.as_number() {
                        Some(n) => Ok(RuntimeValue::Num(n * 86_400_000.0)),
                        None => Ok(RuntimeValue::Null),
                    }
                } else {
                    Ok(RuntimeValue::Null)
                }
            }
            FnName::Hours => {
                if let Some(arg) = args.first() {
                    let v = self.eval_expr(arg)?;
                    match v.as_number() {
                        Some(n) => Ok(RuntimeValue::Num(n * 3_600_000.0)),
                        None => Ok(RuntimeValue::Null),
                    }
                } else {
                    Ok(RuntimeValue::Null)
                }
            }
        }
    }

    pub fn eval_rule(&mut self, rule: &Rule) -> Result<RuleResult, EvalError> {
        let gas_before = self.meter.used();
        let inst_before = self.meter.instruction_count();

        // Evaluate when guard if present
        let (when_evaluated, when_passed) = match &rule.when {
            None => (false, true),
            Some(when_expr) => {
                let res = self.eval_expr(when_expr)?;
                (true, res.is_truthy())
            }
        };

        let (passed, assert_result) = if when_passed {
            let assert_val = self.eval_expr(&rule.assert)?;
            (assert_val.is_truthy(), assert_val)
        } else {
            // Guard not met -> rule vacuously passes
            (true, RuntimeValue::Bool(true))
        };

        let gas_used = self.meter.used().saturating_sub(gas_before);
        let nodes_evaluated = (self.meter.instruction_count().saturating_sub(inst_before)) as u32;

        Ok(RuleResult {
            field: rule.field.clone(),
            message: rule.message.clone(),
            id: rule.id.clone(),
            passed,
            when_evaluated,
            when_passed,
            assert_result,
            gas_used,
            nodes_evaluated,
        })
    }

    pub fn eval_rule_set(&mut self, rule_set: &RuleSet) -> Result<ExecutionTrace, EvalError> {
        let mut rule_results = Vec::with_capacity(rule_set.rules.len());
        let mut rules_passed = 0u32;
        let mut rules_failed = 0u32;

        for rule in &rule_set.rules {
            let result = self.eval_rule(rule)?;
            if result.passed {
                rules_passed += 1;
            } else {
                rules_failed += 1;
            }
            rule_results.push(result);
        }

        let valid = rules_failed == 0;
        let total_gas_used = self.meter.used();
        let gas_limit = self.meter.limit();
        let total_instructions = self.meter.instruction_count();

        Ok(ExecutionTrace::new(
            valid,
            rule_set.rules.len() as u32,
            rules_passed,
            rules_failed,
            total_gas_used,
            gas_limit,
            total_instructions,
            rule_results,
            self.steps.clone(),
        ))
    }
}

/// Helper function to parse ISO-8601 date strings to UTC epoch milliseconds.
fn parse_iso_date(s: &str) -> Option<f64> {
    // Formats: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SSZ" or "YYYY-MM-DDTHH:MM:SS.sssZ"
    let parts: Vec<&str> = s.split('T').collect();
    let date_part = parts[0];
    let ymd: Vec<&str> = date_part.split('-').collect();
    if ymd.len() != 3 {
        return None;
    }

    let year = ymd[0].parse::<i32>().ok()?;
    let month = ymd[1].parse::<u32>().ok()?;
    let day = ymd[2].parse::<u32>().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let (hour, min, sec, ms) = if parts.len() > 1 {
        let time_str = parts[1].trim_end_matches('Z');
        let hms: Vec<&str> = time_str.split(':').collect();
        let h = hms.first().and_then(|x| x.parse::<u32>().ok()).unwrap_or(0);
        let m = hms.get(1).and_then(|x| x.parse::<u32>().ok()).unwrap_or(0);
        let (s, millis) = if let Some(sec_str) = hms.get(2) {
            if let Some((sec_val, frac)) = sec_str.split_once('.') {
                let s = sec_val.parse::<u32>().unwrap_or(0);
                let ms_str = if frac.len() >= 3 { &frac[..3] } else { frac };
                let ms = ms_str.parse::<u32>().unwrap_or(0);
                (s, ms)
            } else {
                (sec_str.parse::<u32>().unwrap_or(0), 0)
            }
        } else {
            (0, 0)
        };
        (h, m, s, millis)
    } else {
        (0, 0, 0, 0)
    };

    // Calculate days since 1970-01-01
    let days = days_from_civil(year, month, day);
    let total_secs =
        (days as i64) * 86400 + (hour as i64) * 3600 + (min as i64) * 60 + (sec as i64);
    let total_ms = (total_secs as f64) * 1000.0 + (ms as f64);
    Some(total_ms)
}

fn days_from_civil(mut y: i32, m: u32, d: u32) -> i32 {
    y -= if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i32 - 719468
}
