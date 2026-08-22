import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateInWasmSandbox,
  verifyTraceSignature,
  createWasmAstResolver,
} from '../../src/lib/ast/index.ts';
import { serializeRuleSetBinary } from '../../src/lib/ast/binary.ts';
import type { RuleSet } from '../../src/lib/ast/types.ts';
import {
  DEFAULT_COMMITMENT_RULES,
  EXAMPLE_AMOUNT_DATE_RULES,
} from '../../src/lib/ast/defaultRules.ts';

const FIXED_NOW = Date.parse('2026-06-15T12:00:00Z');

describe('WASM AST Sandbox Evaluation - Unit & Integration Tests', () => {
  it('evaluates DEFAULT_COMMITMENT_RULES in WASM sandbox', async () => {
    const validValues = {
      dueAt: FIXED_NOW + 86_400_000 * 5, // 5 days in future
      terms: 'Complete deliverables for milestone 1 according to specification',
    };

    const result = await evaluateInWasmSandbox(
      DEFAULT_COMMITMENT_RULES,
      { values: validValues, now: FIXED_NOW },
      { gasLimit: 50_000, recordSteps: true },
    );

    assert.strictEqual(result.valid, true);
    assert.strictEqual(Object.keys(result.errors).length, 0);
    assert(result.gasUsed > 0);
    assert.strictEqual(result.traceHash.length, 64);
    assert(result.durationMs < 50);

    const isValidSignature = await verifyTraceSignature(result.trace);
    assert.strictEqual(isValidSignature, true);
  });

  it('correctly catches rule violations in WASM sandbox', async () => {
    const invalidValues = {
      dueAt: FIXED_NOW + 3_600_000, // only 1 hour in future, but requires >= 24h
      terms: 'TODO fix later', // contains placeholder 'TODO' and < 10 substance
    };

    const result = await evaluateInWasmSandbox(
      DEFAULT_COMMITMENT_RULES,
      { values: invalidValues, now: FIXED_NOW },
      { gasLimit: 50_000 },
    );

    assert.strictEqual(result.valid, false);
    assert(result.errors.dueAt !== undefined);
    assert(result.errors.terms !== undefined);
    assert(result.trace.rules_failed >= 2);
  });

  it('evaluates pre-serialized binary AST byte buffer directly', async () => {
    const binary = serializeRuleSetBinary(EXAMPLE_AMOUNT_DATE_RULES);

    const values = {
      amount: '5000',
      date: '2026-07-01',
    };

    const result = await evaluateInWasmSandbox(
      binary,
      { values, now: FIXED_NOW },
      { recordSteps: true },
    );

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.trace.rules_passed, EXAMPLE_AMOUNT_DATE_RULES.rules.length);
  });

  it('enforces gas metering budget in WASM sandbox', async () => {
    const ruleSet: RuleSet = {
      version: 1,
      rules: [
        {
          field: 'loop_check',
          message: 'Failed budget',
          assert: {
            kind: 'and',
            operands: Array.from({ length: 50 }, () => ({
              kind: 'compare',
              op: '==',
              left: { kind: 'field', name: 'a' },
              right: { kind: 'lit', value: 1 },
            })),
          },
        },
      ],
    };

    // Extremely low gas limit (e.g. 5 units)
    await assert.rejects(async () => {
      await evaluateInWasmSandbox(ruleSet, { values: { a: 1 }, now: FIXED_NOW }, { gasLimit: 5 });
    }, /GasExhausted|execution error/i);
  });

  it('reproduces identical cryptographic trace hash across repeated evaluations', async () => {
    const values = {
      dueAt: FIXED_NOW + 86_400_000 * 2,
      terms: 'Detailed terms agreement for smart contract escrow settlement',
    };

    const res1 = await evaluateInWasmSandbox(
      DEFAULT_COMMITMENT_RULES,
      { values, now: FIXED_NOW },
      { recordSteps: true },
    );

    const res2 = await evaluateInWasmSandbox(
      DEFAULT_COMMITMENT_RULES,
      { values, now: FIXED_NOW },
      { recordSteps: true },
    );

    assert.strictEqual(res1.traceHash, res2.traceHash);
    assert.strictEqual(res1.gasUsed, res2.gasUsed);
  });

  it('meets < 50ms performance requirement for complex nested rule trees', async () => {
    // Generate a deep, complex nested rule set with arithmetic, logic, builtins, and comparisons
    const complexRules: RuleSet = {
      version: 1,
      rules: Array.from({ length: 25 }, (_, i) => ({
        field: `field_${i}`,
        message: `Field ${i} validation failed`,
        id: `rule_complex_${i}`,
        assert: {
          kind: 'or',
          operands: [
            {
              kind: 'and',
              operands: [
                {
                  kind: 'compare',
                  op: '>=',
                  left: {
                    kind: 'arith',
                    op: '+',
                    left: { kind: 'field', name: `val_${i}` },
                    right: { kind: 'lit', value: 10 },
                  },
                  right: { kind: 'lit', value: 50 },
                },
                {
                  kind: 'in',
                  value: { kind: 'field', name: 'status' },
                  set: [
                    { kind: 'lit', value: 'ACTIVE' },
                    { kind: 'lit', value: 'VERIFIED' },
                  ],
                },
              ],
            },
            {
              kind: 'compare',
              op: '==',
              left: {
                kind: 'call',
                fn: 'lower',
                args: [{ kind: 'field', name: 'mode' }],
              },
              right: { kind: 'lit', value: 'bypass' },
            },
          ],
        },
      })),
    };

    const contextValues: Record<string, unknown> = {
      status: 'ACTIVE',
      mode: 'STANDARD',
    };
    for (let i = 0; i < 25; i++) {
      contextValues[`val_${i}`] = 100;
    }

    const start = performance.now();
    const result = await evaluateInWasmSandbox(
      complexRules,
      { values: contextValues, now: FIXED_NOW },
      { gasLimit: 200_000 },
    );
    const duration = performance.now() - start;

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.trace.rules_passed, 25);
    assert(duration < 50, `Execution took ${duration.toFixed(2)}ms, expected < 50ms`);
  });

  it('integrates with createWasmAstResolver for react-hook-form', async () => {
    const resolver = createWasmAstResolver(DEFAULT_COMMITMENT_RULES, {
      now: () => FIXED_NOW,
    });

    // Failing case: dueAt is within 24h
    const invalidForm = await resolver(
      { dueAt: FIXED_NOW + 3_600_000, terms: 'Valid commitment terms longer than ten characters' },
      undefined,
      { fields: {} } as any,
    );

    assert(Object.keys(invalidForm.errors).length > 0);
    assert((invalidForm.errors as any).dueAt !== undefined);

    // Passing case: dueAt >= 24h, valid terms
    const validValues = {
      dueAt: FIXED_NOW + 86_400_000 * 3,
      terms: 'Valid commitment terms longer than ten characters',
    };
    const validForm = await resolver(validValues, undefined, { fields: {} } as any);

    assert.strictEqual(Object.keys(validForm.errors).length, 0);
    assert.deepStrictEqual(validForm.values, validValues);
  });
});
