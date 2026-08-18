# AST-based form validation (`@/lib/ast`)

A safe, sandboxed **rules engine** that evaluates a JSON-defined Abstract Syntax
Tree against form inputs in real time. It lets validation constraints be updated
on the fly via governance — the frontend downloads the current rule set from the
smart contract and enforces it locally — **without deploying new frontend code**.

Implements issue #155:

- ✅ A safe, sandboxed AST evaluator in TypeScript (no `eval` / `new Function`).
- ✅ Hooks into react-hook-form's custom resolver API.
- ✅ Evaluates far under the 16ms typing-lag budget (a 50-rule set: ~20µs/keystroke).

## Why an AST instead of hard-coded Zod?

The static Zod schema still owns *structural* validation (required fields,
Stellar address format). The AST layer adds *dynamic* constraints that governance
can retune — "the due date must be at least 24h out", "terms must be ≥ N chars",
"amount must be > 100" — as data, not code. The two are composed
(`composeResolvers`), so Zod errors on a field always take precedence over a
dynamic error on that same field.

## Safety model

The downloaded JSON is **untrusted**. `compileRuleSet` validates and compiles it
before anything runs:

- **No dynamic code execution.** Nodes are compiled to plain closures; strings
  that look like code are inert data.
- **Structural validation.** Unknown node kinds, operators, or function names,
  wrong arities, and malformed shapes are rejected with `AstValidationError`.
- **Hard limits** (`LIMITS`) bound rule count, node count, nesting depth, operand
  count, and string/regex/message lengths — a DoS guard against pathological
  payloads.
- **Prototype-pollution guard.** Field paths and error paths reject `__proto__`,
  `prototype`, and `constructor`; runtime field reads use own-property access
  only.
- **ReDoS guard.** Regex patterns are length-capped, `g`/`y` (stateful) flags are
  rejected, and match input is length-capped.
- **Total runtime.** For ordinary input the evaluator never throws — an
  out-of-range or type-mismatched comparison is simply `false`. Callers
  (`useValidationRules`) fall back to bundled defaults if a download or compile
  ever fails, so a bad governance payload can never brick the form.

## Rule set shape

```jsonc
{
  "version": 1,
  "rules": [
    {
      "field": "amount",                     // form field the error attaches to (dotted paths allowed)
      "message": "Amount must be > 100.",     // shown when the rule fails
      "assert": { /* Expr — must be truthy for the field to be valid */ },
      "when":   { /* optional Expr — rule only enforced when this is truthy */ },
      "id":     "amount-minimum"              // optional
    }
  ]
}
```

## Expression nodes

| `kind`    | Shape                                              | Meaning |
|-----------|----------------------------------------------------|---------|
| `lit`     | `{ value }`                                        | string / number / boolean / null constant |
| `field`   | `{ name }`                                          | read a (dotted) form-field path |
| `not`     | `{ operand }`                                       | logical NOT of truthiness |
| `and`     | `{ operands: [] }`                                  | logical AND (empty ⇒ true), short-circuits |
| `or`      | `{ operands: [] }`                                  | logical OR (empty ⇒ false), short-circuits |
| `compare` | `{ op, left, right }`                               | `==` `!=` `>` `>=` `<` `<=` |
| `arith`   | `{ op, left, right }`                               | `+` `-` `*` `/` `%` over numbers |
| `in`      | `{ value, set: [] }`                                | strict-equality membership |
| `match`   | `{ value, pattern, flags? }`                        | regex test on the string form of `value` |
| `call`    | `{ fn, args: [] }`                                  | a whitelisted built-in (below) |

### Built-in functions

`now()` · `toNumber(x)` · `toDate(x)` · `len(x)` · `lower(x)` · `upper(x)` ·
`trim(x)` · `isBlank(x)` · `abs(x)` · `days(n)` · `hours(n)`

`now()` returns epoch milliseconds; `toDate` parses ISO strings / epoch numbers to
epoch ms. So "at least 24h in the future" is `toDate(dueAt) >= now() + hours(24)`.

### Type / comparison semantics

- Ordered comparisons (`<`, `<=`, `>`, `>=`) require both sides to be the same
  comparable type (number↔number, string↔string, lexicographic). Anything else —
  including `null`, `NaN`, or mixed types — is **not orderable** and yields `false`.
- `==` / `!=` are strict and type-aware: differing types are never equal.
- Arithmetic on a non-numeric / `null` operand, or divide-by-zero, yields `null`.

## Usage

```ts
import { compileRuleSet, createAstResolver, composeResolvers } from '@/lib/ast';
import { zodResolver } from '@hookform/resolvers/zod';

const compiled = compileRuleSet(ruleSetJson);      // once, when rules load
const resolver = composeResolvers(
  zodResolver(schema),                              // structural
  createAstResolver(compiled),                      // dynamic / governance
);
useForm({ resolver, mode: 'onChange' });
```

In this app, `useValidationRules()` handles downloading (`VITE_VALIDATION_RULES_URL`),
compiling, and falling back to `DEFAULT_COMMITMENT_RULES`, and
`CreateCommitmentWizard` wires the composed resolver into react-hook-form.

## Tests

```bash
cd frontend && npm run test:unit      # node:test — semantics, safety, and the <16ms perf assertion
```
