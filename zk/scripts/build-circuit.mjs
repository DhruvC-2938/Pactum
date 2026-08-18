#!/usr/bin/env node
//
// Compiles trust_threshold.circom and runs a Groth16 setup over it.
//
// The powers-of-tau and phase-2 contributions below use fixed, published entropy
// strings so the build is reproducible. That is exactly what you want for local
// development and for CI, and exactly what you must NOT ship to production: the
// toxic waste is public, so anyone can forge proofs against the resulting key.
// See docs/zk-reputation-proofs.md ("Trusted setup") before deploying this.

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as snarkjs from 'snarkjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(packageRoot, 'build');
const circuitsDir = join(packageRoot, 'circuits');
let circomlibCircuits = join(packageRoot, 'node_modules', 'circomlib', 'circuits');
if (!existsSync(circomlibCircuits)) {
  circomlibCircuits = join(packageRoot, '..', 'node_modules', 'circomlib', 'circuits');
}

// snarkjs is invoked as a child process (see snarkjsCli), so we need its cli.js on
// disk. As an npm workspace its dependencies hoist to the monorepo root, so fall
// back to the root node_modules the same way circomlib does above.
let snarkjsCliPath = join(packageRoot, 'node_modules', 'snarkjs', 'cli.js');
if (!existsSync(snarkjsCliPath)) {
  snarkjsCliPath = join(packageRoot, '..', 'node_modules', 'snarkjs', 'cli.js');
}

const CURVE = 'bn128';
const PTAU_ENTROPY = 'pactum zk-reputation dev ceremony — NOT SECURE, see docs';
const ZKEY_ENTROPY = 'pactum zk-reputation dev phase2 — NOT SECURE, see docs';

/** Runs a command, streaming its output, and fails the build on a non-zero exit. */
function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', cwd: packageRoot });
}

function snarkjsCli(args) {
  run(process.execPath, [snarkjsCliPath, ...args]);
}

/**
 * Smallest powers-of-tau size that fits the circuit.
 *
 * Groth16 needs a domain of at least `constraints + publicInputs + 1` points, and
 * the ceremony cost doubles with every power, so picking this from the compiled
 * r1cs beats hard-coding a generous constant.
 */
function requiredPower(constraints, publicInputs) {
  const needed = constraints + publicInputs + 1;
  let power = 8;
  while (2 ** power < needed) power += 1;
  return power;
}

if (!existsSync(circomlibCircuits)) {
  console.error('circomlib is missing — run `npm install` in zk/ first.');
  process.exit(1);
}

mkdirSync(buildDir, { recursive: true });

// 1. Compile the circuit to r1cs + a WASM witness generator. The WASM is what the
//    browser prover loads; nothing here is Node-specific.
run('circom', [
  join(circuitsDir, 'trust_threshold.circom'),
  '--r1cs',
  '--wasm',
  '--sym',
  '-l',
  circomlibCircuits,
  '-l',
  circuitsDir,
  '-o',
  buildDir,
]);

const r1csPath = join(buildDir, 'trust_threshold.r1cs');
const info = await snarkjs.r1cs.info(r1csPath);
const power = requiredPower(info.nConstraints, info.nPubInputs + info.nOutputs);
console.log(
  `\nCircuit: ${info.nConstraints} constraints, ` +
    `${info.nPubInputs} public inputs, ${info.nOutputs} outputs → 2^${power} ptau`,
);

// 2. Phase 1 — universal powers of tau.
const ptauInit = join(buildDir, `pot${power}_0000.ptau`);
const ptauContributed = join(buildDir, `pot${power}_0001.ptau`);
const ptauFinal = join(buildDir, `pot${power}_final.ptau`);

snarkjsCli(['powersoftau', 'new', CURVE, String(power), ptauInit, '-v']);
snarkjsCli([
  'powersoftau',
  'contribute',
  ptauInit,
  ptauContributed,
  '--name=pactum-dev',
  '-v',
  `-e=${PTAU_ENTROPY}`,
]);
snarkjsCli(['powersoftau', 'prepare', 'phase2', ptauContributed, ptauFinal, '-v']);

// 3. Phase 2 — circuit-specific setup. Groth16's per-circuit ceremony is the price
//    of its small, cheap-to-verify proofs; see the docs for why we accept it here.
const zkeyInit = join(buildDir, 'trust_threshold_0000.zkey');
const zkeyFinal = join(buildDir, 'trust_threshold_final.zkey');
const vkeyPath = join(buildDir, 'verification_key.json');

snarkjsCli(['groth16', 'setup', r1csPath, ptauFinal, zkeyInit]);
snarkjsCli([
  'zkey',
  'contribute',
  zkeyInit,
  zkeyFinal,
  '--name=pactum-dev',
  '-v',
  `-e=${ZKEY_ENTROPY}`,
]);
snarkjsCli(['zkey', 'export', 'verificationkey', zkeyFinal, vkeyPath]);

console.log(`\nBuild complete. Artifacts in ${buildDir}:`);
console.log('  trust_threshold_js/trust_threshold.wasm  — witness generator (browser + node)');
console.log('  trust_threshold_final.zkey               — proving key');
console.log('  verification_key.json                    — verification key');

// `snarkjs.r1cs.info` above builds a curve backed by a worker pool and caches it on
// globalThis. Without terminating it the process never exits — every artifact is
// written, the script just hangs, which in CI means a job that runs until it times out.
await globalThis.curve_bn128?.terminate();
