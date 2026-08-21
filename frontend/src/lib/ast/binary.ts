/**
 * Binary AST Serializer and Deserializer for WASM boundary passing.
 *
 * Implements a compact, deterministic binary serialization protocol for AST expressions
 * and rule sets, allowing fast zero-copy / buffer-based transfers into the WebAssembly sandbox.
 */

import type { ArithOp, CompareOp, Expr, FnName, Rule, RuleSet, RuntimeValue } from './types.ts';

export const MAGIC_HEADER = new Uint8Array([0x50, 0x41, 0x53, 0x54]); // "PAST"

export const TAG_EXPR_LIT = 1;
export const TAG_EXPR_FIELD = 2;
export const TAG_EXPR_NOT = 3;
export const TAG_EXPR_AND = 4;
export const TAG_EXPR_OR = 5;
export const TAG_EXPR_COMPARE = 6;
export const TAG_EXPR_ARITH = 7;
export const TAG_EXPR_IN = 8;
export const TAG_EXPR_MATCH = 9;
export const TAG_EXPR_CALL = 10;

export const LIT_NULL = 0;
export const LIT_BOOL_FALSE = 1;
export const LIT_BOOL_TRUE = 2;
export const LIT_NUM = 3;
export const LIT_STR = 4;

const COMPARE_OP_TO_TAG: Record<CompareOp, number> = {
  '==': 1,
  '!=': 2,
  '>': 3,
  '>=': 4,
  '<': 5,
  '<=': 6,
};

const TAG_TO_COMPARE_OP: Record<number, CompareOp> = {
  1: '==',
  2: '!=',
  3: '>',
  4: '>=',
  5: '<',
  6: '<=',
};

const ARITH_OP_TO_TAG: Record<ArithOp, number> = {
  '+': 1,
  '-': 2,
  '*': 3,
  '/': 4,
  '%': 5,
};

const TAG_TO_ARITH_OP: Record<number, ArithOp> = {
  1: '+',
  2: '-',
  3: '*',
  4: '/',
  5: '%',
};

const FN_NAME_TO_TAG: Record<FnName, number> = {
  now: 1,
  toNumber: 2,
  toDate: 3,
  len: 4,
  lower: 5,
  upper: 6,
  trim: 7,
  isBlank: 8,
  abs: 9,
  days: 10,
  hours: 11,
};

const TAG_TO_FN_NAME: Record<number, FnName> = {
  1: 'now',
  2: 'toNumber',
  3: 'toDate',
  4: 'len',
  5: 'lower',
  6: 'upper',
  7: 'trim',
  8: 'isBlank',
  9: 'abs',
  10: 'days',
  11: 'hours',
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }

  private ensureCapacity(needed: number): void {
    if (this.offset + needed <= this.buffer.length) return;
    let nextCap = this.buffer.length * 2;
    while (this.offset + needed > nextCap) {
      nextCap *= 2;
    }
    const newBuf = new Uint8Array(nextCap);
    newBuf.set(this.buffer.subarray(0, this.offset));
    this.buffer = newBuf;
    this.view = new DataView(this.buffer.buffer);
  }

  public writeU8(val: number): void {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = val & 0xff;
  }

  public writeU32(val: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, val, true);
    this.offset += 4;
  }

  public writeF64(val: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, val, true);
    this.offset += 8;
  }

  public writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  public writeString(str: string): void {
    const encoded = textEncoder.encode(str);
    this.writeU32(encoded.length);
    this.writeBytes(encoded);
  }

  public writeOptString(str?: string | null): void {
    if (str === undefined || str === null) {
      this.writeU8(0);
    } else {
      this.writeU8(1);
      this.writeString(str);
    }
  }

  public toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }
}

export class BinaryReader {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(bytes: Uint8Array) {
    this.buffer = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  public remaining(): number {
    return this.buffer.byteLength - this.offset;
  }

  public readU8(): number {
    if (this.offset + 1 > this.buffer.byteLength) {
      throw new Error('Unexpected EOF reading u8');
    }
    return this.buffer[this.offset++];
  }

  public readU32(): number {
    if (this.offset + 4 > this.buffer.byteLength) {
      throw new Error('Unexpected EOF reading u32');
    }
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  public readF64(): number {
    if (this.offset + 8 > this.buffer.byteLength) {
      throw new Error('Unexpected EOF reading f64');
    }
    const val = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return val;
  }

  public readBytes(length: number): Uint8Array {
    if (this.offset + length > this.buffer.byteLength) {
      throw new Error(`Unexpected EOF reading ${length} bytes`);
    }
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  public readString(): string {
    const len = this.readU32();
    const bytes = this.readBytes(len);
    return textDecoder.decode(bytes);
  }

  public readOptString(): string | undefined {
    const flag = this.readU8();
    if (flag === 0) return undefined;
    return this.readString();
  }
}

export function serializeRuntimeValue(val: RuntimeValue, writer: BinaryWriter): void {
  if (val === null) {
    writer.writeU8(LIT_NULL);
  } else if (typeof val === 'boolean') {
    writer.writeU8(val ? LIT_BOOL_TRUE : LIT_BOOL_FALSE);
  } else if (typeof val === 'number') {
    writer.writeU8(LIT_NUM);
    writer.writeF64(val);
  } else if (typeof val === 'string') {
    writer.writeU8(LIT_STR);
    writer.writeString(val);
  }
}

export function deserializeRuntimeValue(reader: BinaryReader): RuntimeValue {
  const tag = reader.readU8();
  switch (tag) {
    case LIT_NULL:
      return null;
    case LIT_BOOL_FALSE:
      return false;
    case LIT_BOOL_TRUE:
      return true;
    case LIT_NUM:
      return reader.readF64();
    case LIT_STR:
      return reader.readString();
    default:
      throw new Error(`Invalid runtime value tag: ${tag}`);
  }
}

export function serializeExpr(expr: Expr, writer: BinaryWriter): void {
  switch (expr.kind) {
    case 'lit':
      writer.writeU8(TAG_EXPR_LIT);
      serializeRuntimeValue(expr.value, writer);
      break;

    case 'field':
      writer.writeU8(TAG_EXPR_FIELD);
      writer.writeString(expr.name);
      break;

    case 'not':
      writer.writeU8(TAG_EXPR_NOT);
      serializeExpr(expr.operand, writer);
      break;

    case 'and':
      writer.writeU8(TAG_EXPR_AND);
      writer.writeU32(expr.operands.length);
      for (const op of expr.operands) {
        serializeExpr(op, writer);
      }
      break;

    case 'or':
      writer.writeU8(TAG_EXPR_OR);
      writer.writeU32(expr.operands.length);
      for (const op of expr.operands) {
        serializeExpr(op, writer);
      }
      break;

    case 'compare':
      writer.writeU8(TAG_EXPR_COMPARE);
      writer.writeU8(COMPARE_OP_TO_TAG[expr.op]);
      serializeExpr(expr.left, writer);
      serializeExpr(expr.right, writer);
      break;

    case 'arith':
      writer.writeU8(TAG_EXPR_ARITH);
      writer.writeU8(ARITH_OP_TO_TAG[expr.op]);
      serializeExpr(expr.left, writer);
      serializeExpr(expr.right, writer);
      break;

    case 'in':
      writer.writeU8(TAG_EXPR_IN);
      serializeExpr(expr.value, writer);
      writer.writeU32(expr.set.length);
      for (const item of expr.set) {
        serializeExpr(item, writer);
      }
      break;

    case 'match':
      writer.writeU8(TAG_EXPR_MATCH);
      serializeExpr(expr.value, writer);
      writer.writeString(expr.pattern);
      writer.writeOptString(expr.flags);
      break;

    case 'call':
      writer.writeU8(TAG_EXPR_CALL);
      writer.writeU8(FN_NAME_TO_TAG[expr.fn]);
      writer.writeU32(expr.args.length);
      for (const arg of expr.args) {
        serializeExpr(arg, writer);
      }
      break;

    default:
      throw new Error(`Unknown expression kind: ${(expr as any).kind}`);
  }
}

export function deserializeExpr(reader: BinaryReader): Expr {
  const tag = reader.readU8();
  switch (tag) {
    case TAG_EXPR_LIT:
      return { kind: 'lit', value: deserializeRuntimeValue(reader) };

    case TAG_EXPR_FIELD:
      return { kind: 'field', name: reader.readString() };

    case TAG_EXPR_NOT:
      return { kind: 'not', operand: deserializeExpr(reader) };

    case TAG_EXPR_AND: {
      const count = reader.readU32();
      const operands: Expr[] = [];
      for (let i = 0; i < count; i++) {
        operands.push(deserializeExpr(reader));
      }
      return { kind: 'and', operands };
    }

    case TAG_EXPR_OR: {
      const count = reader.readU32();
      const operands: Expr[] = [];
      for (let i = 0; i < count; i++) {
        operands.push(deserializeExpr(reader));
      }
      return { kind: 'or', operands };
    }

    case TAG_EXPR_COMPARE: {
      const opTag = reader.readU8();
      const op = TAG_TO_COMPARE_OP[opTag];
      if (!op) throw new Error(`Unknown compare op tag: ${opTag}`);
      const left = deserializeExpr(reader);
      const right = deserializeExpr(reader);
      return { kind: 'compare', op, left, right };
    }

    case TAG_EXPR_ARITH: {
      const opTag = reader.readU8();
      const op = TAG_TO_ARITH_OP[opTag];
      if (!op) throw new Error(`Unknown arith op tag: ${opTag}`);
      const left = deserializeExpr(reader);
      const right = deserializeExpr(reader);
      return { kind: 'arith', op, left, right };
    }

    case TAG_EXPR_IN: {
      const value = deserializeExpr(reader);
      const count = reader.readU32();
      const set: Expr[] = [];
      for (let i = 0; i < count; i++) {
        set.push(deserializeExpr(reader));
      }
      return { kind: 'in', value, set };
    }

    case TAG_EXPR_MATCH: {
      const value = deserializeExpr(reader);
      const pattern = reader.readString();
      const flags = reader.readOptString();
      return { kind: 'match', value, pattern, flags };
    }

    case TAG_EXPR_CALL: {
      const fnTag = reader.readU8();
      const fn = TAG_TO_FN_NAME[fnTag];
      if (!fn) throw new Error(`Unknown fn tag: ${fnTag}`);
      const count = reader.readU32();
      const args: Expr[] = [];
      for (let i = 0; i < count; i++) {
        args.push(deserializeExpr(reader));
      }
      return { kind: 'call', fn, args };
    }

    default:
      throw new Error(`Unknown expr tag: ${tag}`);
  }
}

export function serializeRule(rule: Rule, writer: BinaryWriter): void {
  writer.writeString(rule.field);
  writer.writeString(rule.message);
  writer.writeOptString(rule.id);
  serializeExpr(rule.assert, writer);
  if (rule.when) {
    writer.writeU8(1);
    serializeExpr(rule.when, writer);
  } else {
    writer.writeU8(0);
  }
}

export function deserializeRule(reader: BinaryReader): Rule {
  const field = reader.readString();
  const message = reader.readString();
  const id = reader.readOptString();
  const assert = deserializeExpr(reader);
  const hasWhen = reader.readU8();
  const when = hasWhen !== 0 ? deserializeExpr(reader) : undefined;
  const rule: Rule = { field, message, assert };
  if (id !== undefined) rule.id = id;
  if (when !== undefined) rule.when = when;
  return rule;
}

/**
 * Serializes a complete RuleSet into optimized binary format.
 */
export function serializeRuleSetBinary(ruleSet: RuleSet): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeBytes(MAGIC_HEADER);
  writer.writeU32(ruleSet.version);
  writer.writeU32(ruleSet.rules.length);
  for (const rule of ruleSet.rules) {
    serializeRule(rule, writer);
  }
  return writer.toUint8Array();
}

/**
 * Deserializes a binary buffer back into a RuleSet object.
 */
export function deserializeRuleSetBinary(bytes: Uint8Array): RuleSet {
  const reader = new BinaryReader(bytes);
  const magic = reader.readBytes(4);
  for (let i = 0; i < 4; i++) {
    if (magic[i] !== MAGIC_HEADER[i]) {
      throw new Error('Invalid magic header in binary AST');
    }
  }
  const version = reader.readU32();
  if (version !== 1) {
    throw new Error(`Unsupported binary AST version: ${version}`);
  }
  const count = reader.readU32();
  const rules: Rule[] = [];
  for (let i = 0; i < count; i++) {
    rules.push(deserializeRule(reader));
  }
  return { version: 1, rules };
}
