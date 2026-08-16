import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  DEFAULT_TREE_DEPTH,
  EMPTY_LEAF,
  buildPoseidonHash,
  buildSnapshot,
  findLeafIndex,
  leafForEntry,
  merklePath,
  sortEntries,
  type PoseidonHash,
} from '../src/tree.ts';
import { testAddress, testEntries } from './helpers.ts';

// Depth 4 keeps these tests fast; the circuit's own depth is exercised in circuit.test.ts.
const SHALLOW_DEPTH = 4;

describe('reputation snapshot', () => {
  let hash: PoseidonHash;

  before(async () => {
    hash = await buildPoseidonHash();
  });

  it('orders entries by address so independent rebuilds agree', () => {
    const entries = testEntries();
    const shuffled = [entries[3], entries[0], entries[5], entries[1], entries[4], entries[2]];

    assert.deepEqual(sortEntries(shuffled), sortEntries(entries));
    assert.equal(
      buildSnapshot(hash, shuffled, SHALLOW_DEPTH).root,
      buildSnapshot(hash, entries, SHALLOW_DEPTH).root,
    );
  });

  it('pads unused slots with the empty leaf', () => {
    const snapshot = buildSnapshot(hash, testEntries(), SHALLOW_DEPTH);
    assert.equal(snapshot.leaves.length, 2 ** SHALLOW_DEPTH);
    assert.equal(snapshot.leaves[testEntries().length], EMPTY_LEAF);
  });

  it('changes the root when any score changes', () => {
    const entries = testEntries();
    const before = buildSnapshot(hash, entries, SHALLOW_DEPTH).root;

    const bumped = entries.map((entry, index) =>
      index === 2 ? { ...entry, score: entry.score + 1 } : entry,
    );
    assert.notEqual(buildSnapshot(hash, bumped, SHALLOW_DEPTH).root, before);
  });

  it('produces a path that rehashes to the root for every entry', () => {
    const entries = testEntries();
    const snapshot = buildSnapshot(hash, entries, SHALLOW_DEPTH);

    for (const entry of entries) {
      const index = findLeafIndex(entries, entry.address);
      const path = merklePath(snapshot, index);

      assert.equal(path.leaf, leafForEntry(hash, entry));

      let current = path.leaf;
      for (let level = 0; level < SHALLOW_DEPTH; level++) {
        const sibling = path.pathElements[level];
        current =
          path.pathIndices[level] === 1 ? hash([sibling, current]) : hash([current, sibling]);
      }
      assert.equal(current, snapshot.root, `path did not reach the root for ${entry.address}`);
    }
  });

  it('rejects a leaf index outside the tree', () => {
    const snapshot = buildSnapshot(hash, testEntries(), SHALLOW_DEPTH);
    assert.throws(() => merklePath(snapshot, 2 ** SHALLOW_DEPTH), /outside the snapshot/);
    assert.throws(() => merklePath(snapshot, -1), /outside the snapshot/);
  });

  it('rejects more entries than the depth can hold', () => {
    const tooMany = Array.from({ length: 5 }, (_, index) => ({
      address: testAddress(index),
      score: 100,
    }));
    assert.throws(() => buildSnapshot(hash, tooMany, 2), /at most 4 entries/);
  });

  it('reports -1 for an address that is not in the snapshot', () => {
    assert.equal(findLeafIndex(testEntries(), testAddress(99)), -1);
  });

  it('defaults to the depth the circuit was compiled for', () => {
    assert.equal(DEFAULT_TREE_DEPTH, 16);
  });
});
