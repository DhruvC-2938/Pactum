#!/usr/bin/env node
//
// Off-chain verifier (AC #2), as a command a verifier can actually run.
//
//   node scripts/verify-proof.mjs \
//     --proof proof.json --public public.json --vkey build/verification_key.json \
//     --root <snapshot root> --min-threshold 800 --context 424242
//
// Exits 0 when the proof is valid *and* says what the verifier requires it to say.
// Every one of --root, --min-threshold and --context is mandatory on purpose: a
// verifier that skips them accepts proofs against stale snapshots, trivial thresholds,
// or another verifier's context, all of which pass the pairing check unharmed.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { verifyTrustThresholdProof } from '../src/verify.ts';

const { values } = parseArgs({
  options: {
    proof: { type: 'string' },
    public: { type: 'string' },
    vkey: { type: 'string' },
    root: { type: 'string' },
    'min-threshold': { type: 'string' },
    context: { type: 'string' },
  },
});

const required = ['proof', 'public', 'vkey', 'root', 'min-threshold', 'context'];
const missing = required.filter((option) => values[option] === undefined);

if (missing.length > 0) {
  console.error(`Missing required option(s): ${missing.map((o) => `--${o}`).join(', ')}`);
  console.error(
    'Usage: node scripts/verify-proof.mjs --proof <f> --public <f> --vkey <f> ' +
      '--root <n> --min-threshold <n> --context <n>',
  );
  process.exit(2);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const result = await verifyTrustThresholdProof({
  proof: readJson(values.proof),
  publicSignals: readJson(values.public),
  verificationKey: readJson(values.vkey),
  expectedRoot: BigInt(values.root),
  minThreshold: BigInt(values['min-threshold']),
  expectedContextId: BigInt(values.context),
});

if (!result.valid) {
  console.error(`REJECTED: ${result.reason}`);
  process.exit(1);
}

console.log('ACCEPTED');
console.log(`  proven threshold: > ${result.signals.threshold}`);
console.log(`  snapshot root:    ${result.signals.root}`);
console.log(`  context:          ${result.signals.contextId}`);

// snarkjs leaves a worker-backed curve object behind; without this the process hangs.
await globalThis.curve_bn128?.terminate();
