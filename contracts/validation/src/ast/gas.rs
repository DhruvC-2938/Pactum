extern crate alloc;

use alloc::string::String;

pub const DEFAULT_GAS_LIMIT: u64 = 100_000;

pub const COST_BASE_NODE: u64 = 1;
pub const COST_LITERAL: u64 = 1;
pub const COST_FIELD_BASE: u64 = 2;
pub const COST_FIELD_SEGMENT: u64 = 1;
pub const COST_COMPARE: u64 = 2;
pub const COST_ARITH: u64 = 2;
pub const COST_LOGIC: u64 = 1;
pub const COST_IN_ITEM: u64 = 2;
pub const COST_REGEX_BASE: u64 = 10;
pub const COST_CALL_BASE: u64 = 2;
pub const COST_STRING_CHAR: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GasError {
    GasExhausted {
        gas_limit: u64,
        gas_used: u64,
        required: u64,
        operation: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GasMeter {
    gas_limit: u64,
    gas_used: u64,
    instruction_count: u64,
}

impl GasMeter {
    pub fn new(gas_limit: u64) -> Self {
        Self {
            gas_limit,
            gas_used: 0,
            instruction_count: 0,
        }
    }

    pub fn with_default_limit() -> Self {
        Self::new(DEFAULT_GAS_LIMIT)
    }

    pub fn remaining(&self) -> u64 {
        self.gas_limit.saturating_sub(self.gas_used)
    }

    pub fn used(&self) -> u64 {
        self.gas_used
    }

    pub fn limit(&self) -> u64 {
        self.gas_limit
    }

    pub fn instruction_count(&self) -> u64 {
        self.instruction_count
    }

    pub fn record_instruction(&mut self) {
        self.instruction_count = self.instruction_count.saturating_add(1);
    }

    pub fn consume(&mut self, amount: u64, operation: &str) -> Result<(), GasError> {
        self.record_instruction();
        let new_used = self.gas_used.saturating_add(amount);
        if new_used > self.gas_limit {
            self.gas_used = self.gas_limit;
            Err(GasError::GasExhausted {
                gas_limit: self.gas_limit,
                gas_used: self.gas_used,
                required: amount,
                operation: String::from(operation),
            })
        } else {
            self.gas_used = new_used;
            Ok(())
        }
    }
}
