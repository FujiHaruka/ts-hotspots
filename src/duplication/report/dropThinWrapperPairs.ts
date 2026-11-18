import type { ScoredPair, ThinWrapperVerdicts } from "./jsonReport.ts";

/**
 * Drop pairs whose **both** sides are "thin wrappers" — fragments whose
 * body is just `return <SharedComponent ... />;` (with at most a couple
 * of trivial `const x = call(...)` preludes). Such pairs are already
 * DRYed against a shared component / helper, so they can't yield a
 * useful refactor suggestion.
 *
 * The judgement is supplied via `thinVerdicts` (precomputed
 * per-side `fragmentId -> boolean` maps). Building the maps is
 * the caller's responsibility — this keeps `dropThinWrapperPairs` pure and lets the
 * pipeline avoid re-parsing for fragments that appear in multiple
 * pairs.
 *
 * Pairs where only one side is a thin wrapper are kept; the
 * `recommendationHint` layer flags them with `"thin-wrapper-side"`.
 */
export function dropThinWrapperPairs(
  pairs: readonly ScoredPair[],
  thinVerdicts: ThinWrapperVerdicts,
): ScoredPair[] {
  const out: ScoredPair[] = [];
  for (const pair of pairs) {
    const changedThin = thinVerdicts.changed.get(pair.changedFragment.id) ?? false;
    const baseThin = thinVerdicts.base.get(pair.baseFragment.id) ?? false;
    if (changedThin && baseThin) {
      continue;
    }
    out.push(pair);
  }
  return out;
}
