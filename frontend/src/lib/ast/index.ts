/**
 * `@/lib/ast` — a safe, sandboxed AST rules engine for dynamic form validation.
 *
 * Public surface:
 * - Types describing the rule language ({@link Expr}, {@link Rule}, {@link RuleSet}).
 * - {@link compileRuleSet} — validate + compile untrusted JSON into an executable form.
 * - {@link createAstResolver} / {@link composeResolvers} — react-hook-form integration.
 * - {@link DEFAULT_COMMITMENT_RULES} — bundled fallback rules.
 *
 * See `README.md` in this directory for the language reference and safety model.
 */

export type {
  ArithOp,
  CompareOp,
  CompiledExpr,
  CompiledRule,
  CompiledRuleSet,
  EvalContext,
  Expr,
  FnName,
  Rule,
  RuleSet,
  RuntimeValue,
} from './types.ts';

export { AstValidationError, AstEvaluationError } from './errors.ts';
export { compileRuleSet, LIMITS } from './compiler.ts';
export { createAstResolver, createWasmAstResolver, composeResolvers } from './resolver.ts';
export type { AstResolverOptions } from './resolver.ts';
export { DEFAULT_COMMITMENT_RULES, EXAMPLE_AMOUNT_DATE_RULES } from './defaultRules.ts';
export {
  serializeRuleSetBinary,
  deserializeRuleSetBinary,
  serializeExpr,
  deserializeExpr,
  MAGIC_HEADER,
} from './binary.ts';
export {
  evaluateInWasmSandbox,
  verifyTraceSignature,
  ensureWasmSandboxInitialized,
} from './sandbox.ts';
export type {
  ExecutionTrace,
  RuleResult,
  TraceStep,
  WasmExecutionResult,
  WasmEvalOptions,
} from './sandbox.ts';
