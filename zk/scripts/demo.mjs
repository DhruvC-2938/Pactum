#!/usr/bin/env node
//
// End-to-end walkthrough of the flow in docs/zk-reputation-proofs.md, in one file.
//
//   npm run build:circuit && node scripts/demo.mjs
//
// It plays all three roles in sequence — indexer, user's browser, verifying DAO —
// and writes proof.json / public.json into build/ so scripts/verify-proof.mjs has
// something real to check.

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Keypair } from '@stellar/stellar-sdk';

import { generateTrustThresholdProof } from '../src/prove.ts';
import { trustScore } from '../src/score.ts';
import { buildPoseidonHash, buildSnapshot, findLeafIndex, merklePath } from '../src/tree.ts';
import { verifyTrustThresholdProof } from '../src/verify.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(packageRoot, 'build');
const artifacts = {
  wasm: join(buildDir, 'trust_threshold_js', 'trust_threshold.wasm'),
  zkey: join(buildDir, 'trust_threshold_final.zkey'),
};
const vkeyPath = join(buildDir, 'verification_key.json');

if (!existsSync(artifacts.zkey)) {
  console.error('Circuit artifacts are missing — run `npm run build:circuit` first.');
  process.exit(1);
}

const THRESHOLD = 800;
const DAO_CONTEXT_ID = 424242n;

/** Deterministic stand-ins for indexed addresses. */
const account = (index) => {
  const seed = Buffer.alloc(32);
  seed.writeUInt32BE(index + 1, 28);
  return Keypair.fromRawEd25519Seed(seed).publicKey();
};

// --- 1. Indexer: aggregate on-chain outcomes and publish a snapshot ---------------
const indexed = [
  { address: account(0), fulfilled: 19, late: 1, breached: 0 },
  { address: account(1), fulfilled: 4, late: 3, breached: 2 },
  { address: account(2), fulfilled: 8, late: 0, breached: 4 },
  { address: account(3), fulfilled: 30, late: 2, breached: 1 },
];

const entries = indexed
  .map((record) => ({ address: record.address, score: trustScore(record) }))
  .sort((a, b) => (a.address < b.address ? -1 : 1));

const hash = await buildPoseidonHash();
const snapshot = buildSnapshot(hash, entries);

console.log('1. Indexer published a snapshot');
console.log(`   root: ${snapshot.root}`);
for (const entry of entries) {
  console.log(`   ${entry.address}  score ${entry.score}`);
}

// --- 2. User's browser: rebuild locally, prove --------------------------------------
// The user downloads the snapshot above in full. No request identifies them, and the
// address, score and path below never leave this process.
const me = indexed[3];
const myScore = trustScore(me);
const myPath = merklePath(snapshot, findLeafIndex(entries, me.address));

console.log(`\n2. User proves score > ${THRESHOLD} locally (actual score ${myScore}, kept private)`);

const started = process.hrtime.bigint();
const { proof, publicSignals } = await generateTrustThresholdProof(
  {
    address: me.address,
    score: myScore,
    threshold: THRESHOLD,
    contextId: DAO_CONTEXT_ID,
    path: myPath,
  },
  artifacts,
);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

console.log(`   proved in ${elapsedMs.toFixed(0)} ms`);
console.log(`   public signals: ${JSON.stringify(publicSignals)}`);
console.log('   ^ nothing here reveals the address or the score');

writeFileSync(join(buildDir, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
writeFileSync(join(buildDir, 'public.json'), `${JSON.stringify(publicSignals, null, 2)}\n`);

// --- 3. DAO: verify off-chain --------------------------------------------------------
const { default: vkey } = await import(vkeyPath, { with: { type: 'json' } });

const accepted = await verifyTrustThresholdProof({
  proof,
  publicSignals,
  verificationKey: vkey,
  expectedRoot: snapshot.root,
  minThreshold: BigInt(THRESHOLD),
  expectedContextId: DAO_CONTEXT_ID,
});

console.log(`\n3. DAO verifies off-chain: ${accepted.valid ? 'ACCEPTED' : `REJECTED (${accepted.reason})`}`);

// And the same proof presented to a different DAO is refused.
const replayed = await verifyTrustThresholdProof({
  proof,
  publicSignals,
  verificationKey: vkey,
  expectedRoot: snapshot.root,
  minThreshold: BigInt(THRESHOLD),
  expectedContextId: DAO_CONTEXT_ID + 1n,
});

console.log(`   same proof replayed at another DAO: ${replayed.valid ? 'ACCEPTED' : `REJECTED (${replayed.reason})`}`);
console.log(`\nWrote build/proof.json and build/public.json — try scripts/verify-proof.mjs.`);

await globalThis.curve_bn128?.terminate();
