/**
 * WASM Sandbox Execution Driver for Pactum Legal AST Validation.
 *
 * Bridges the TypeScript AST rules engine with the isolated, gas-metered Rust WebAssembly
 * sandbox (`pactum_validation_bg.wasm`). Ensures deterministic execution, halts on infinite
 * loops, and produces cryptographically verifiable execution traces.
 */

import initWasm, {
  evaluate_ast_binary,
  verify_trace_hash,
} from '../../wasm/pactum-validation/pactum_validation.js';
import { serializeRuleSetBinary } from './binary.ts';
import type { EvalContext, RuleSet, RuntimeValue } from './types.ts';

export interface TraceStep {
  step_index: number;
  node_kind: string;
  detail: string;
  result: RuntimeValue;
  gas_used: number;
}

export interface RuleResult {
  field: string;
  message: string;
  id?: string;
  passed: boolean;
  when_evaluated: boolean;
  when_passed: boolean;
  assert_result: RuntimeValue;
  gas_used: number;
  nodes_evaluated: number;
}

export interface ExecutionTrace {
  valid: boolean;
  rules_evaluated: number;
  rules_passed: number;
  rules_failed: number;
  total_gas_used: number;
  gas_limit: number;
  total_instructions: number;
  rule_results: RuleResult[];
  steps: TraceStep[];
  trace_hash: string;
}

export interface WasmEvalOptions {
  /** Maximum gas units before execution terminates (default 100,000). */
  gasLimit?: number;
  /** Whether to capture detailed step-by-step trace in addition to rule summaries. */
  recordSteps?: boolean;
}

export interface WasmExecutionResult {
  valid: boolean;
  errors: Record<string, { type: string; message: string }>;
  trace: ExecutionTrace;
  gasUsed: number;
  traceHash: string;
  durationMs: number;
}

let wasmInitPromise: Promise<void> | null = null;
let wasmInitialized = false;

async function getWasmModuleSource(): Promise<BufferSource | string | URL> {
  const g = globalThis as any;
  if (typeof g.window === 'undefined' && typeof g.process !== 'undefined') {
    try {
      const fs = await (Function('return import("node:fs")')() as Promise<any>);
      const path = await (Function('return import("node:path")')() as Promise<any>);
      const url = await (Function('return import("node:url")')() as Promise<any>);
      const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
      const wasmPath = path.resolve(
        currentDir,
        '../../wasm/pactum-validation/pactum_validation_bg.wasm',
      );
      if (fs.existsSync(wasmPath)) {
        return fs.readFileSync(wasmPath);
      }
    } catch {
      // Fallback to default
    }
  }
  return new URL('../../wasm/pactum-validation/pactum_validation_bg.wasm', import.meta.url);
}

export async function ensureWasmSandboxInitialized(): Promise<void> {
  if (wasmInitialized) return;
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      try {
        const source = await getWasmModuleSource();
        await initWasm(source as any);
        wasmInitialized = true;
      } catch (err) {
        wasmInitPromise = null;
        throw err;
      }
    })();
  }
  await wasmInitPromise;
}

/**
 * Executes a validation RuleSet inside the WebAssembly deterministic sandbox.
 *
 * @param ruleSet The RuleSet or pre-serialized binary buffer to evaluate.
 * @param context The runtime evaluation context (form values and current time).
 * @param options Configuration for gas limits and trace granularity.
 */
export async function evaluateInWasmSandbox(
  ruleSet: RuleSet | Uint8Array,
  context: EvalContext,
  options: WasmEvalOptions = {},
): Promise<WasmExecutionResult> {
  await ensureWasmSandboxInitialized();

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const contextJson = JSON.stringify({
    values: context.values,
    now: context.now,
  });

  const gasLimit = options.gasLimit ?? 100_000;
  const recordSteps = options.recordSteps ?? false;

  let rawTrace: ExecutionTrace;

  if (ruleSet instanceof Uint8Array) {
    rawTrace = evaluate_ast_binary(ruleSet, contextJson, gasLimit, recordSteps) as ExecutionTrace;
  } else {
    // Serialize to binary for fast boundary passing
    const binaryAst = serializeRuleSetBinary(ruleSet);
    rawTrace = evaluate_ast_binary(binaryAst, contextJson, gasLimit, recordSteps) as ExecutionTrace;
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = endTime - startTime;

  const errors: Record<string, { type: string; message: string }> = {};
  const claimed = new Set<string>();

  for (const r of rawTrace.rule_results) {
    if (!r.passed && !claimed.has(r.field)) {
      errors[r.field] = {
        type: 'ast_wasm',
        message: r.message,
      };
      claimed.add(r.field);
    }
  }

  return {
    valid: rawTrace.valid,
    errors,
    trace: rawTrace,
    gasUsed: rawTrace.total_gas_used,
    traceHash: rawTrace.trace_hash,
    durationMs,
  };
}

/**
 * Validates a trace's cryptographic SHA-256 signature against its execution events.
 */
export async function verifyTraceSignature(trace: ExecutionTrace): Promise<boolean> {
  await ensureWasmSandboxInitialized();
  return verify_trace_hash(JSON.stringify(trace));
}
