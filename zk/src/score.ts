/**
 * The Trust Score: a single 0..1000 number derived from the on-chain
 * fulfilled / late / breached counts the registry contract keeps per address.
 *
 * The contract deliberately stores only counts (see `contracts/registry/src/reputation.rs`)
 * so the weighting stays an off-chain policy decision. This module is that policy, and
 * both the indexer building a snapshot and the browser rebuilding it must agree on it
 * exactly — a one-point disagreement changes every leaf and invalidates every proof.
 */

/** Aggregate outcome counts for an address, as returned by `get_reputation`. */
export interface ReputationCounts {
  fulfilled: number;
  late: number;
  breached: number;
}

/** Upper bound of the Trust Score range; an address that only ever delivered on time. */
export const MAX_TRUST_SCORE = 1000;

/** Weight applied to each outcome, out of `MAX_TRUST_SCORE`. */
const OUTCOME_WEIGHTS = {
  fulfilled: 1000,
  late: 500,
  breached: 0,
} as const;

/**
 * Computes the Trust Score for a set of outcome counts.
 *
 * Addresses with no settled commitments score 0 rather than being treated as
 * perfect — an empty history is not a good history, and scoring it 1000 would let
 * a fresh address clear any threshold.
 *
 * Integer floor division keeps this reproducible across languages and avoids
 * floating point drift between the indexer and the browser.
 */
export function trustScore(counts: ReputationCounts): number {
  const { fulfilled, late, breached } = counts;

  if (![fulfilled, late, breached].every((n) => Number.isInteger(n) && n >= 0)) {
    throw new Error('Reputation counts must be non-negative integers');
  }

  const total = fulfilled + late + breached;
  if (total === 0) return 0;

  const weighted = fulfilled * OUTCOME_WEIGHTS.fulfilled + late * OUTCOME_WEIGHTS.late;
  return Math.floor(weighted / total);
}
