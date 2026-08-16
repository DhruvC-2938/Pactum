/**
 * The reputation Merkle tree.
 *
 * A snapshot is a Poseidon binary tree over one leaf per address:
 *
 *     leaf = Poseidon(addrHi, addrLo, score)
 *
 * Poseidon rather than SHA-256/Keccak because the circuit has to recompute one hash
 * per tree level: Poseidon costs a few hundred R1CS constraints, SHA-256 costs tens
 * of thousands. At depth 16 that is the difference between a circuit that proves in
 * a browser tab and one that does not.
 *
 * Every input to the tree is public on-chain data, so the whole snapshot can be
 * published. That is deliberate — it is what lets a user rebuild the tree locally and
 * read off their own path without telling a server which address they care about.
 */

import { buildPoseidon } from 'circomlibjs';

import { addressToLimbs } from './strkey.ts';

/** Depth used by the compiled circuit. Changing it requires recompiling. */
export const DEFAULT_TREE_DEPTH = 16;

/** Hashes a list of field elements with Poseidon. */
export type PoseidonHash = (inputs: bigint[]) => bigint;

/** One address and its Trust Score, as published in a snapshot. */
export interface ReputationEntry {
  address: string;
  score: number;
}

export interface ReputationSnapshot {
  depth: number;
  root: bigint;
  /** Padded to 2^depth; entries beyond the real ones are `EMPTY_LEAF`. */
  leaves: bigint[];
  /** `layers[0]` is the leaf layer, `layers[depth]` is the single-element root layer. */
  layers: bigint[][];
}

export interface MerklePath {
  leaf: bigint;
  root: bigint;
  pathElements: bigint[];
  /** 0 when the running hash is the left child at that level, 1 when it is the right. */
  pathIndices: number[];
}

/** Value stored in unused leaf slots. */
export const EMPTY_LEAF = 0n;

/**
 * Loads the Poseidon implementation.
 *
 * `circomlibjs` and the `circomlib` circuits share the same BN254 parameters, which is
 * what makes an in-circuit hash agree with one computed here. Building it is async
 * (it compiles a small WASM module), so callers hold onto the result.
 */
export async function buildPoseidonHash(): Promise<PoseidonHash> {
  const poseidon = await buildPoseidon();
  return (inputs: bigint[]) => BigInt(poseidon.F.toString(poseidon(inputs)));
}

/** Computes the leaf commitment for one address/score pair. */
export function leafForEntry(hash: PoseidonHash, entry: ReputationEntry): bigint {
  const { hi, lo } = addressToLimbs(entry.address);
  return hash([hi, lo, BigInt(entry.score)]);
}

/**
 * Canonical snapshot ordering: ascending by address.
 *
 * The order fixes every leaf index, so the publisher and the browser must derive it
 * the same way. Sorting by address means the snapshot file does not have to carry
 * indices, and two independent rebuilds of the same entry set always agree.
 */
export function sortEntries(entries: ReputationEntry[]): ReputationEntry[] {
  return [...entries].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}

/** Builds the full tree over `entries`, padding to capacity with `EMPTY_LEAF`. */
export function buildSnapshot(
  hash: PoseidonHash,
  entries: ReputationEntry[],
  depth: number = DEFAULT_TREE_DEPTH,
): ReputationSnapshot {
  const capacity = 2 ** depth;
  const ordered = sortEntries(entries);

  if (ordered.length > capacity) {
    throw new Error(`Snapshot holds at most ${capacity} entries at depth ${depth}`);
  }

  const leaves: bigint[] = new Array(capacity).fill(EMPTY_LEAF);
  ordered.forEach((entry, index) => {
    leaves[index] = leafForEntry(hash, entry);
  });

  const layers: bigint[][] = [leaves];
  for (let level = 0; level < depth; level++) {
    const previous = layers[level];
    const next: bigint[] = new Array(previous.length / 2);
    for (let i = 0; i < next.length; i++) {
      next[i] = hash([previous[2 * i], previous[2 * i + 1]]);
    }
    layers.push(next);
  }

  return { depth, root: layers[depth][0], leaves, layers };
}

/** Reads the authentication path for the leaf at `index` out of a built snapshot. */
export function merklePath(snapshot: ReputationSnapshot, index: number): MerklePath {
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.leaves.length) {
    throw new Error(`Leaf index ${index} is outside the snapshot`);
  }

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let position = index;

  for (let level = 0; level < snapshot.depth; level++) {
    const isRight = position % 2;
    pathElements.push(snapshot.layers[level][isRight ? position - 1 : position + 1]);
    pathIndices.push(isRight);
    position = Math.floor(position / 2);
  }

  return { leaf: snapshot.leaves[index], root: snapshot.root, pathElements, pathIndices };
}

/**
 * Finds an address's leaf index in a snapshot.
 *
 * Called locally on a snapshot the user already downloaded in full. Asking a server
 * for this index instead would hand it the very address the proof is meant to hide.
 */
export function findLeafIndex(entries: ReputationEntry[], address: string): number {
  return sortEntries(entries).findIndex((entry) => entry.address === address);
}
