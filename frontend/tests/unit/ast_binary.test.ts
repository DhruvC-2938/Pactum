import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deserializeExpr,
  deserializeRuleSetBinary,
  deserializeRuntimeValue,
  MAGIC_HEADER,
  serializeExpr,
  serializeRuleSetBinary,
  serializeRuntimeValue,
  BinaryReader,
  BinaryWriter,
} from '../../src/lib/ast/binary.ts';
import type { Expr, RuleSet } from '../../src/lib/ast/types.ts';
import {
  DEFAULT_COMMITMENT_RULES,
  EXAMPLE_AMOUNT_DATE_RULES,
} from '../../src/lib/ast/defaultRules.ts';

describe('AST Binary Codec - Unit Tests', () => {
  it('encodes and decodes runtime values', () => {
    const values = [null, false, true, 0, 42.5, -100.25, '', 'hello world', 'nested.field.path'];

    for (const val of values) {
      const writer = new BinaryWriter();
      serializeRuntimeValue(val, writer);
      const bytes = writer.toUint8Array();

      const reader = new BinaryReader(bytes);
      const decoded = deserializeRuntimeValue(reader);
      assert.deepStrictEqual(decoded, val);
    }
  });

  it('encodes and decodes all AST expression kinds', () => {
    const expressions: Expr[] = [
      { kind: 'lit', value: 123.45 },
      { kind: 'lit', value: 'sample string' },
      { kind: 'lit', value: null },
      { kind: 'field', name: 'user.profile.age' },
      { kind: 'not', operand: { kind: 'field', name: 'isExpired' } },
      {
        kind: 'and',
        operands: [
          { kind: 'lit', value: true },
          {
            kind: 'compare',
            op: '>',
            left: { kind: 'field', name: 'amount' },
            right: { kind: 'lit', value: 0 },
          },
        ],
      },
      {
        kind: 'or',
        operands: [
          { kind: 'lit', value: false },
          {
            kind: 'compare',
            op: '==',
            left: { kind: 'field', name: 'role' },
            right: { kind: 'lit', value: 'ADMIN' },
          },
        ],
      },
      {
        kind: 'compare',
        op: '<=',
        left: { kind: 'field', name: 'count' },
        right: { kind: 'lit', value: 10 },
      },
      {
        kind: 'arith',
        op: '+',
        left: { kind: 'field', name: 'subtotal' },
        right: { kind: 'field', name: 'tax' },
      },
      {
        kind: 'in',
        value: { kind: 'field', name: 'status' },
        set: [
          { kind: 'lit', value: 'OPEN' },
          { kind: 'lit', value: 'PENDING' },
          { kind: 'lit', value: 'CLOSED' },
        ],
      },
      {
        kind: 'match',
        value: { kind: 'field', name: 'code' },
        pattern: '^[A-Z]{3}-[0-9]{4}$',
        flags: 'i',
      },
      {
        kind: 'call',
        fn: 'now',
        args: [],
      },
      {
        kind: 'call',
        fn: 'days',
        args: [{ kind: 'lit', value: 7 }],
      },
      {
        kind: 'call',
        fn: 'trim',
        args: [{ kind: 'field', name: 'memo' }],
      },
    ];

    for (const expr of expressions) {
      const writer = new BinaryWriter();
      serializeExpr(expr, writer);
      const bytes = writer.toUint8Array();

      const reader = new BinaryReader(bytes);
      const decoded = deserializeExpr(reader);
      assert.deepStrictEqual(decoded, expr);
    }
  });

  it('round-trips full RuleSets into binary and back', () => {
    const ruleSets: RuleSet[] = [
      DEFAULT_COMMITMENT_RULES,
      EXAMPLE_AMOUNT_DATE_RULES,
      {
        version: 1,
        rules: [
          {
            field: 'custom_rate',
            message: 'Custom rate must be between 0 and 1',
            id: 'rule_rate',
            assert: {
              kind: 'and',
              operands: [
                {
                  kind: 'compare',
                  op: '>=',
                  left: { kind: 'field', name: 'custom_rate' },
                  right: { kind: 'lit', value: 0 },
                },
                {
                  kind: 'compare',
                  op: '<=',
                  left: { kind: 'field', name: 'custom_rate' },
                  right: { kind: 'lit', value: 1 },
                },
              ],
            },
            when: {
              kind: 'compare',
              op: '!=',
              left: { kind: 'field', name: 'custom_rate' },
              right: { kind: 'lit', value: null },
            },
          },
        ],
      },
    ];

    for (const ruleSet of ruleSets) {
      const binary = serializeRuleSetBinary(ruleSet);
      assert(binary.length > 8);
      assert.strictEqual(binary[0], MAGIC_HEADER[0]);
      assert.strictEqual(binary[1], MAGIC_HEADER[1]);
      assert.strictEqual(binary[2], MAGIC_HEADER[2]);
      assert.strictEqual(binary[3], MAGIC_HEADER[3]);

      const decoded = deserializeRuleSetBinary(binary);
      assert.deepStrictEqual(decoded, ruleSet);
    }
  });

  it('rejects malformed binary data with descriptive errors', () => {
    const invalidHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert.throws(() => deserializeRuleSetBinary(invalidHeader), /magic header/);

    const invalidVersion = new Uint8Array([
      ...MAGIC_HEADER,
      0x02,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assert.throws(() => deserializeRuleSetBinary(invalidVersion), /version/);
  });
});
