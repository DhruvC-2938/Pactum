extern crate alloc;

use alloc::boxed::Box;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use super::types::{ArithOp, CompareOp, Expr, FnName, Rule, RuleSet, RuntimeValue};

pub const MAGIC_HEADER: &[u8; 4] = b"PAST";

pub const TAG_EXPR_LIT: u8 = 1;
pub const TAG_EXPR_FIELD: u8 = 2;
pub const TAG_EXPR_NOT: u8 = 3;
pub const TAG_EXPR_AND: u8 = 4;
pub const TAG_EXPR_OR: u8 = 5;
pub const TAG_EXPR_COMPARE: u8 = 6;
pub const TAG_EXPR_ARITH: u8 = 7;
pub const TAG_EXPR_IN: u8 = 8;
pub const TAG_EXPR_MATCH: u8 = 9;
pub const TAG_EXPR_CALL: u8 = 10;

pub const LIT_NULL: u8 = 0;
pub const LIT_BOOL_FALSE: u8 = 1;
pub const LIT_BOOL_TRUE: u8 = 2;
pub const LIT_NUM: u8 = 3;
pub const LIT_STR: u8 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecError {
    UnexpectedEof,
    InvalidMagic,
    UnsupportedVersion(u32),
    InvalidTag(u8),
    InvalidUtf8,
    InvalidData(String),
}

pub struct BinaryWriter {
    buf: Vec<u8>,
}

impl Default for BinaryWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl BinaryWriter {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            buf: Vec::with_capacity(capacity),
        }
    }

    pub fn write_u8(&mut self, val: u8) {
        self.buf.push(val);
    }

    pub fn write_u32(&mut self, val: u32) {
        self.buf.extend_from_slice(&val.to_le_bytes());
    }

    pub fn write_f64(&mut self, val: f64) {
        self.buf.extend_from_slice(&val.to_le_bytes());
    }

    pub fn write_str(&mut self, val: &str) {
        let bytes = val.as_bytes();
        self.write_u32(bytes.len() as u32);
        self.buf.extend_from_slice(bytes);
    }

    pub fn write_opt_str(&mut self, val: &Option<String>) {
        match val {
            None => self.write_u8(0),
            Some(s) => {
                self.write_u8(1);
                self.write_str(s);
            }
        }
    }

    pub fn finish(self) -> Vec<u8> {
        self.buf
    }
}

pub struct BinaryReader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> BinaryReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.offset)
    }

    pub fn read_u8(&mut self) -> Result<u8, CodecError> {
        if self.offset >= self.data.len() {
            return Err(CodecError::UnexpectedEof);
        }
        let b = self.data[self.offset];
        self.offset += 1;
        Ok(b)
    }

    pub fn read_bytes(&mut self, count: usize) -> Result<&'a [u8], CodecError> {
        if self.offset + count > self.data.len() {
            return Err(CodecError::UnexpectedEof);
        }
        let slice = &self.data[self.offset..self.offset + count];
        self.offset += count;
        Ok(slice)
    }

    pub fn read_u32(&mut self) -> Result<u32, CodecError> {
        let bytes = self.read_bytes(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    pub fn read_f64(&mut self) -> Result<f64, CodecError> {
        let bytes = self.read_bytes(8)?;
        Ok(f64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }

    pub fn read_str(&mut self) -> Result<String, CodecError> {
        let len = self.read_u32()? as usize;
        let bytes = self.read_bytes(len)?;
        core::str::from_utf8(bytes)
            .map(|s| s.to_string())
            .map_err(|_| CodecError::InvalidUtf8)
    }

    pub fn read_opt_str(&mut self) -> Result<Option<String>, CodecError> {
        let flag = self.read_u8()?;
        if flag == 0 {
            Ok(None)
        } else {
            Ok(Some(self.read_str()?))
        }
    }
}

pub fn serialize_runtime_value(val: &RuntimeValue, writer: &mut BinaryWriter) {
    match val {
        RuntimeValue::Null => {
            writer.write_u8(LIT_NULL);
        }
        RuntimeValue::Bool(false) => {
            writer.write_u8(LIT_BOOL_FALSE);
        }
        RuntimeValue::Bool(true) => {
            writer.write_u8(LIT_BOOL_TRUE);
        }
        RuntimeValue::Num(n) => {
            writer.write_u8(LIT_NUM);
            writer.write_f64(*n);
        }
        RuntimeValue::Str(s) => {
            writer.write_u8(LIT_STR);
            writer.write_str(s);
        }
    }
}

pub fn deserialize_runtime_value(reader: &mut BinaryReader) -> Result<RuntimeValue, CodecError> {
    let tag = reader.read_u8()?;
    match tag {
        LIT_NULL => Ok(RuntimeValue::Null),
        LIT_BOOL_FALSE => Ok(RuntimeValue::Bool(false)),
        LIT_BOOL_TRUE => Ok(RuntimeValue::Bool(true)),
        LIT_NUM => {
            let n = reader.read_f64()?;
            Ok(RuntimeValue::Num(n))
        }
        LIT_STR => {
            let s = reader.read_str()?;
            Ok(RuntimeValue::Str(s))
        }
        _ => Err(CodecError::InvalidTag(tag)),
    }
}

pub fn serialize_expr(expr: &Expr, writer: &mut BinaryWriter) {
    match expr {
        Expr::Lit { value } => {
            writer.write_u8(TAG_EXPR_LIT);
            serialize_runtime_value(value, writer);
        }
        Expr::Field { name } => {
            writer.write_u8(TAG_EXPR_FIELD);
            writer.write_str(name);
        }
        Expr::Not { operand } => {
            writer.write_u8(TAG_EXPR_NOT);
            serialize_expr(operand, writer);
        }
        Expr::And { operands } => {
            writer.write_u8(TAG_EXPR_AND);
            writer.write_u32(operands.len() as u32);
            for op in operands {
                serialize_expr(op, writer);
            }
        }
        Expr::Or { operands } => {
            writer.write_u8(TAG_EXPR_OR);
            writer.write_u32(operands.len() as u32);
            for op in operands {
                serialize_expr(op, writer);
            }
        }
        Expr::Compare { op, left, right } => {
            writer.write_u8(TAG_EXPR_COMPARE);
            writer.write_u8(*op as u8);
            serialize_expr(left, writer);
            serialize_expr(right, writer);
        }
        Expr::Arith { op, left, right } => {
            writer.write_u8(TAG_EXPR_ARITH);
            writer.write_u8(*op as u8);
            serialize_expr(left, writer);
            serialize_expr(right, writer);
        }
        Expr::In { value, set } => {
            writer.write_u8(TAG_EXPR_IN);
            serialize_expr(value, writer);
            writer.write_u32(set.len() as u32);
            for item in set {
                serialize_expr(item, writer);
            }
        }
        Expr::Match {
            value,
            pattern,
            flags,
        } => {
            writer.write_u8(TAG_EXPR_MATCH);
            serialize_expr(value, writer);
            writer.write_str(pattern);
            writer.write_opt_str(flags);
        }
        Expr::Call { fn_name, args } => {
            writer.write_u8(TAG_EXPR_CALL);
            writer.write_u8(*fn_name as u8);
            writer.write_u32(args.len() as u32);
            for arg in args {
                serialize_expr(arg, writer);
            }
        }
    }
}

pub fn deserialize_expr(reader: &mut BinaryReader) -> Result<Expr, CodecError> {
    let tag = reader.read_u8()?;
    match tag {
        TAG_EXPR_LIT => {
            let value = deserialize_runtime_value(reader)?;
            Ok(Expr::Lit { value })
        }
        TAG_EXPR_FIELD => {
            let name = reader.read_str()?;
            Ok(Expr::Field { name })
        }
        TAG_EXPR_NOT => {
            let operand = Box::new(deserialize_expr(reader)?);
            Ok(Expr::Not { operand })
        }
        TAG_EXPR_AND => {
            let count = reader.read_u32()? as usize;
            let mut operands = Vec::with_capacity(count);
            for _ in 0..count {
                operands.push(deserialize_expr(reader)?);
            }
            Ok(Expr::And { operands })
        }
        TAG_EXPR_OR => {
            let count = reader.read_u32()? as usize;
            let mut operands = Vec::with_capacity(count);
            for _ in 0..count {
                operands.push(deserialize_expr(reader)?);
            }
            Ok(Expr::Or { operands })
        }
        TAG_EXPR_COMPARE => {
            let op_byte = reader.read_u8()?;
            let op = match op_byte {
                1 => CompareOp::Eq,
                2 => CompareOp::Neq,
                3 => CompareOp::Gt,
                4 => CompareOp::Gte,
                5 => CompareOp::Lt,
                6 => CompareOp::Lte,
                _ => return Err(CodecError::InvalidTag(op_byte)),
            };
            let left = Box::new(deserialize_expr(reader)?);
            let right = Box::new(deserialize_expr(reader)?);
            Ok(Expr::Compare { op, left, right })
        }
        TAG_EXPR_ARITH => {
            let op_byte = reader.read_u8()?;
            let op = match op_byte {
                1 => ArithOp::Add,
                2 => ArithOp::Sub,
                3 => ArithOp::Mul,
                4 => ArithOp::Div,
                5 => ArithOp::Mod,
                _ => return Err(CodecError::InvalidTag(op_byte)),
            };
            let left = Box::new(deserialize_expr(reader)?);
            let right = Box::new(deserialize_expr(reader)?);
            Ok(Expr::Arith { op, left, right })
        }
        TAG_EXPR_IN => {
            let value = Box::new(deserialize_expr(reader)?);
            let count = reader.read_u32()? as usize;
            let mut set = Vec::with_capacity(count);
            for _ in 0..count {
                set.push(deserialize_expr(reader)?);
            }
            Ok(Expr::In { value, set })
        }
        TAG_EXPR_MATCH => {
            let value = Box::new(deserialize_expr(reader)?);
            let pattern = reader.read_str()?;
            let flags = reader.read_opt_str()?;
            Ok(Expr::Match {
                value,
                pattern,
                flags,
            })
        }
        TAG_EXPR_CALL => {
            let fn_byte = reader.read_u8()?;
            let fn_name = match fn_byte {
                1 => FnName::Now,
                2 => FnName::ToNumber,
                3 => FnName::ToDate,
                4 => FnName::Len,
                5 => FnName::Lower,
                6 => FnName::Upper,
                7 => FnName::Trim,
                8 => FnName::IsBlank,
                9 => FnName::Abs,
                10 => FnName::Days,
                11 => FnName::Hours,
                _ => return Err(CodecError::InvalidTag(fn_byte)),
            };
            let count = reader.read_u32()? as usize;
            let mut args = Vec::with_capacity(count);
            for _ in 0..count {
                args.push(deserialize_expr(reader)?);
            }
            Ok(Expr::Call { fn_name, args })
        }
        _ => Err(CodecError::InvalidTag(tag)),
    }
}

pub fn serialize_rule(rule: &Rule, writer: &mut BinaryWriter) {
    writer.write_str(&rule.field);
    writer.write_str(&rule.message);
    writer.write_opt_str(&rule.id);
    serialize_expr(&rule.assert, writer);
    match &rule.when {
        None => writer.write_u8(0),
        Some(w) => {
            writer.write_u8(1);
            serialize_expr(w, writer);
        }
    }
}

pub fn deserialize_rule(reader: &mut BinaryReader) -> Result<Rule, CodecError> {
    let field = reader.read_str()?;
    let message = reader.read_str()?;
    let id = reader.read_opt_str()?;
    let assert = deserialize_expr(reader)?;
    let has_when = reader.read_u8()?;
    let when = if has_when == 0 {
        None
    } else {
        Some(deserialize_expr(reader)?)
    };

    Ok(Rule {
        field,
        message,
        assert,
        when,
        id,
    })
}

pub fn serialize_rule_set(rule_set: &RuleSet) -> Vec<u8> {
    let mut writer = BinaryWriter::new();
    writer.buf.extend_from_slice(MAGIC_HEADER);
    writer.write_u32(rule_set.version);
    writer.write_u32(rule_set.rules.len() as u32);
    for rule in &rule_set.rules {
        serialize_rule(rule, &mut writer);
    }
    writer.finish()
}

pub fn deserialize_rule_set(bytes: &[u8]) -> Result<RuleSet, CodecError> {
    let mut reader = BinaryReader::new(bytes);
    let magic = reader.read_bytes(4)?;
    if magic != MAGIC_HEADER {
        return Err(CodecError::InvalidMagic);
    }
    let version = reader.read_u32()?;
    if version != 1 {
        return Err(CodecError::UnsupportedVersion(version));
    }
    let count = reader.read_u32()? as usize;
    let mut rules = Vec::with_capacity(count);
    for _ in 0..count {
        rules.push(deserialize_rule(&mut reader)?);
    }
    Ok(RuleSet { version, rules })
}
