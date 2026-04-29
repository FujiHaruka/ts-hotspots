import type { ScoredPair } from "./jsonReport.ts";

/**
 * Drop pairs whose **both** sides are "thin wrappers" — fragments whose
 * body is just `return <SharedComponent ... />;` (with at most a couple
 * of trivial `const x = call(...)` preludes). Such pairs are already
 * DRYed against a shared component / helper, so they can't yield a
 * useful refactor suggestion.
 *
 * The judgement is supplied via `isThinById` (a precomputed
 * `fragmentId -> boolean` map). Building the map is the caller's
 * responsibility — this keeps `dropThinWrapperPairs` pure and lets the
 * pipeline avoid re-parsing for fragments that appear in multiple
 * pairs.
 *
 * Pairs where only one side is a thin wrapper are kept; the
 * `recommendationHint` layer flags them with `"thin-wrapper-side"`.
 */
export function dropThinWrapperPairs(
  pairs: readonly ScoredPair[],
  isThinById: ReadonlyMap<string, boolean>,
): ScoredPair[] {
  const out: ScoredPair[] = [];
  for (const pair of pairs) {
    const changedThin = isThinById.get(pair.changedFragment.id) ?? false;
    const baseThin = isThinById.get(pair.baseFragment.id) ?? false;
    if (changedThin && baseThin) {
      continue;
    }
    out.push(pair);
  }
  return out;
}
