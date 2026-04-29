import type { CandidateScore } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";

export interface RankablePair {
  score: CandidateScore;
  changedFragment: Fragment;
  baseFragment: Fragment;
}

/**
 * Sort candidate pairs into the report's deterministic display order.
 *
 * Ordering keys, evaluated in turn:
 * 1. `score.combined` descending.
 * 2. `max(tokenOverlap, statementKindSimilarity, callOverlap)` descending
 *    — breaks ties by promoting candidates with at least one strong axis.
 * 3. `changedFragment.id` ascending (lexicographic).
 * 4. `baseFragment.id` ascending (lexicographic).
 *
 * The function returns a new array; the input is not mutated.
 */
export function sortCandidates<T extends RankablePair>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(compare);
}

function compare(a: RankablePair, b: RankablePair): number {
  if (a.score.combined !== b.score.combined) {
    return b.score.combined - a.score.combined;
  }
  const maxA = maxAxis(a.score);
  const maxB = maxAxis(b.score);
  if (maxA !== maxB) {
    return maxB - maxA;
  }
  if (a.changedFragment.id !== b.changedFragment.id) {
    return a.changedFragment.id < b.changedFragment.id ? -1 : 1;
  }
  if (a.baseFragment.id !== b.baseFragment.id) {
    return a.baseFragment.id < b.baseFragment.id ? -1 : 1;
  }
  return 0;
}

function maxAxis(score: CandidateScore): number {
  const { tokenOverlap, statementKindSimilarity, callOverlap } =
    score.breakdown;
  return Math.max(tokenOverlap, statementKindSimilarity, callOverlap);
}
