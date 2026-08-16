#!/usr/bin/env node
//
// Builds a publishable reputation snapshot from indexed outcome counts.
//
// This is the indexer side of the flow: it turns per-address fulfilled/late/breached
// counts into Trust Scores, commits them to a Poseidon Merkle tree, and writes the
// whole thing out. The output is served verbatim to every caller — it is public data,
// and publishing all of it is exactly what lets a user derive their own Merkle path
// without telling anyone which address is theirs.
//
//   node scripts/publish-snapshot.mjs <counts.json> [snapshot.json]
//
// Input:  [{ "address": "G...", "fulfilled": 10, "late": 2, "breached": 1 }, ...]
// Output: { "root": "...", "depth": 16, "entries": [{ "address": "G...", "score": 846 }, ...] }

import { readFileSync, writeFileSync } from 'node:fs';

import { trustScore } from '../src/score.ts';
import { DEFAULT_TREE_DEPTH, buildPoseidonHash, buildSnapshot, sortEntries } from '../src/tree.ts';

const [countsPath, outputPath = 'snapshot.json'] = process.argv.slice(2);

if (!countsPath) {
  console.error('Usage: node scripts/publish-snapshot.mjs <counts.json> [snapshot.json]');
  process.exit(1);
}

const counts = JSON.parse(readFileSync(countsPath, 'utf8'));

const entries = sortEntries(
  counts.map((record) => ({
    address: record.address,
    score: trustScore({
      fulfilled: record.fulfilled,
      late: record.late,
      breached: record.breached,
    }),
  })),
);

const hash = await buildPoseidonHash();
const snapshot = buildSnapshot(hash, entries);

writeFileSync(
  outputPath,
  `${JSON.stringify(
    { root: snapshot.root.toString(), depth: DEFAULT_TREE_DEPTH, entries },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${outputPath}`);
console.log(`  entries: ${entries.length} (capacity ${2 ** DEFAULT_TREE_DEPTH})`);
console.log(`  root:    ${snapshot.root}`);
