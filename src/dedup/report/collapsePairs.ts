import type { FragmentKind } from "../domain/fragment.ts";
import type { ScoredPair } from "./jsonReport.ts";

/**
 * Drop redundant sub-pairs when a larger enclosing pair already reports the
 * same clone.
 *
 * Two pairs P_sub and P_super are collapse-related when they share the same
 * `(changedFile, baseFile)` bucket and `P_super` line-inclusively contains
 * `P_sub` on BOTH sides (changed and base). In that case we keep P_super —
 * the larger unit carries enough signal for the downstream consumer, and
 * the sub-pair is just the cross-granularity echo emitted by M1 (function /
 * block / window overlapping by design).
 *
 * One-sided containment is deliberately kept: if only the changed side is
 * contained but the base sides point at unrelated regions, the sub-pair
 * reports a distinct clone and must survive.
 *
 * Determinism: pairs within a bucket are sorted by a total, dependency-only
 * order before the one-pass survival check, so the kept set is identical on
 * repeated runs.
 */
export function collapsePairs(
  pairs: readonly ScoredPair[],
): ScoredPair[] {
  if (pairs.length === 0) return [];

  const buckets = new Map<string, ScoredPair[]>();
  for (const pair of pairs) {
    const key = `${pair.changedFragment.filePath}|${pair.baseFragment.filePath}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(pair);
  }

  const sortedBuckets = [...buckets.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const survivors: ScoredPair[] = [];

  for (const [, bucket] of sortedBuckets) {
    const ordered = [...bucket].sort(comparePreferLarger);
    const kept: ScoredPair[] = [];
    for (const candidate of ordered) {
      if (kept.some((k) => containsOnBothSides(k, candidate))) {
        continue;
      }
      kept.push(candidate);
    }
    survivors.push(...kept);
  }

  return survivors;
}

function containsOnBothSides(outer: ScoredPair, inner: ScoredPair): boolean {
  if (outer === inner) return false;
  return (
    containsRange(outer.changedFragment, inner.changedFragment) &&
    containsRange(outer.baseFragment, inner.baseFragment)
  );
}

function containsRange(
  outer: { startLine: number; endLine: number },
  inner: { startLine: number; endLine: number },
): boolean {
  return (
    outer.startLine <= inner.startLine && outer.endLine >= inner.endLine
  );
}

/**
 * Sort pairs so the most "enclosing" candidate comes first.
 *
 * Primary key: sum of line spans on both sides, descending — larger ranges
 * are tried first as potential supers.
 * Tie-breaks (all deterministic, no Map-iteration dependency):
 *   1. kind priority on the changed fragment (function > block > window)
 *   2. kind priority on the base fragment
 *   3. changed fragment id ascending
 *   4. base fragment id ascending
 */
function comparePreferLarger(a: ScoredPair, b: ScoredPair): number {
  const sizeA = rangeSize(a.changedFragment) + rangeSize(a.baseFragment);
  const sizeB = rangeSize(b.changedFragment) + rangeSize(b.baseFragment);
  if (sizeA !== sizeB) return sizeB - sizeA;

  const kindA = KIND_PRIORITY[a.changedFragment.kind];
  const kindB = KIND_PRIORITY[b.changedFragment.kind];
  if (kindA !== kindB) return kindA - kindB;

  const baseKindA = KIND_PRIORITY[a.baseFragment.kind];
  const baseKindB = KIND_PRIORITY[b.baseFragment.kind];
  if (baseKindA !== baseKindB) return baseKindA - baseKindB;

  if (a.changedFragment.id !== b.changedFragment.id) {
    return a.changedFragment.id < b.changedFragment.id ? -1 : 1;
  }
  if (a.baseFragment.id !== b.baseFragment.id) {
    return a.baseFragment.id < b.baseFragment.id ? -1 : 1;
  }
  return 0;
}

function rangeSize(f: { startLine: number; endLine: number }): number {
  return f.endLine - f.startLine + 1;
}

const KIND_PRIORITY: Record<FragmentKind, number> = {
  function: 0,
  block: 1,
  window: 2,
};
