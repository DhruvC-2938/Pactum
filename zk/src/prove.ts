/**
 * Proof generation.
 *
 * Everything here runs unchanged in Node and in a browser tab: `groth16.fullProve`
 * takes the circuit's WASM witness generator and the proving key either as URLs it
 * fetches or as in-memory bytes. No secret ever leaves the caller's process — see
 * docs/zk-reputation-proofs.md for the end-to-end browser flow.
 */

import * as snarkjs from 'snarkjs';

import { DEFAULT_TREE_DEPTH, type MerklePath } from './tree.ts';
import { addressToLimbs } from './strkey.ts';

/** Circuit artifacts, as a path/URL string or as raw bytes. */
export type CircuitArtifact = string | Uint8Array;

export interface TrustProofRequest {
  /** The prover's own `G...` address. Private input — never send this anywhere. */
  address: string;
  /** The prover's exact Trust Score. Private input. */
  score: number;
  /** The bar to clear, strictly. Public. */
  threshold: number;
  /** Verifier/session binding that stops the proof being replayed elsewhere. Public. */
  contextId: bigint;
  /** Authentication path, read out of a locally rebuilt snapshot. Private. */
  path: MerklePath;
}

/** The witness assignment handed to the circuit, with every value stringified. */
export interface TrustCircuitInput {
  root: string;
  threshold: string;
  contextId: string;
  addrHi: string;
  addrLo: string;
  score: string;
  pathElements: string[];
  pathIndices: string[];
}

/**
 * A Groth16 proof in snarkjs' JSON shape.
 *
 * Declared here rather than imported because snarkjs ships no type definitions.
 */
export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface TrustProof {
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Turns a proof request into the circuit's witness input.
 *
 * Exported separately from `generateTrustThresholdProof` so tests can exercise
 * witness construction — including the cases that must fail — without a proving key.
 */
export function toCircuitInput(request: TrustProofRequest): TrustCircuitInput {
  const { address, score, threshold, contextId, path } = request;

  if (path.pathElements.length !== path.pathIndices.length) {
    throw new Error('Merkle path elements and indices must be the same length');
  }
  if (path.pathElements.length !== DEFAULT_TREE_DEPTH) {
    throw new Error(
      `Circuit expects a depth-${DEFAULT_TREE_DEPTH} path, got ${path.pathElements.length}`,
    );
  }

  const { hi, lo } = addressToLimbs(address);

  return {
    root: path.root.toString(),
    threshold: threshold.toString(),
    contextId: contextId.toString(),
    addrHi: hi.toString(),
    addrLo: lo.toString(),
    score: score.toString(),
    pathElements: path.pathElements.map((element) => element.toString()),
    pathIndices: path.pathIndices.map((index) => index.toString()),
  };
}

/**
 * Generates a Groth16 proof that the prover's score exceeds `threshold`.
 *
 * Rejects — rather than returning an unsatisfiable proof — when the score does not
 * clear the threshold or the path does not reach the root, because the circuit
 * constrains `aboveThreshold === 1` and the root to match.
 */
export async function generateTrustThresholdProof(
  request: TrustProofRequest,
  artifacts: { wasm: CircuitArtifact; zkey: CircuitArtifact },
): Promise<TrustProof> {
  const input = toCircuitInput(request);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    artifacts.wasm,
    artifacts.zkey,
  );
  return { proof, publicSignals };
}
