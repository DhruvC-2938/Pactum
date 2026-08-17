/**
 * Shared test fixtures.
 *
 * Addresses are derived from fixed seeds so every run builds the same tree and the
 * same root — a randomly generated set would make failures impossible to reproduce.
 */

import { Keypair } from '@stellar/stellar-sdk';

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const buildDir = join(packageRoot, 'build');

export const artifacts = {
  wasm: join(buildDir, 'trust_threshold_js', 'trust_threshold.wasm'),
  zkey: join(buildDir, 'trust_threshold_final.zkey'),
  vkey: join(buildDir, 'verification_key.json'),
};

/** True when `npm run build:circuit` has produced everything the circuit tests need. */
export function circuitArtifactsPresent(): boolean {
  return Object.values(artifacts).every((path) => existsSync(path));
}

/** Deterministic `G...` address for a test index. */
export function testAddress(index: number): string {
  const seed = Buffer.alloc(32);
  seed.writeUInt32BE(index + 1, 28);
  return Keypair.fromRawEd25519Seed(seed).publicKey();
}

/** A small set of addresses with hand-picked scores around the 800 threshold. */
export function testEntries(): { address: string; score: number }[] {
  return [
    { address: testAddress(0), score: 950 },
    { address: testAddress(1), score: 801 },
    { address: testAddress(2), score: 800 },
    { address: testAddress(3), score: 799 },
    { address: testAddress(4), score: 0 },
    { address: testAddress(5), score: 1000 },
  ];
}
