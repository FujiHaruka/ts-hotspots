/**
 * Deterministic candidate ordering. Sort key:
 *   1. support * confidenceMax desc
 *   2. lift desc
 *   3. lex (pathA, pathB) asc
 * `limit === Number.POSITIVE_INFINITY` opts out of truncation, matching how
 * comp/dup/arch handle `--limit all`.
 */

import type { Candidate } from "./types.ts";

interface SortOptions {
  limit?: number;
}

export function sortCandidates(
  candidates: readonly Candidate[],
  options: SortOptions = {},
): Candidate[] {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const sorted = [...candidates].sort(compareCandidates);
  if (limit === Number.POSITIVE_INFINITY) return sorted;
  if (limit <= 0) return [];
  return sorted.slice(0, limit);
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const aPrimary = a.metrics.support * a.metrics.confidenceMax;
  const bPrimary = b.metrics.support * b.metrics.confidenceMax;
  if (aPrimary !== bPrimary) return bPrimary - aPrimary;

  if (a.metrics.lift !== b.metrics.lift) return b.metrics.lift - a.metrics.lift;

  if (a.pathA !== b.pathA) return a.pathA < b.pathA ? -1 : 1;
  if (a.pathB !== b.pathB) return a.pathB < b.pathB ? -1 : 1;
  return 0;
}
