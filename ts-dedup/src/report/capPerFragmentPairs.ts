import type { ScoredPair } from "./jsonReport.ts";

/**
 * Cap how many reported pairs a single fragment can participate in.
 *
 * A small subset of fragments — typically window-shaped file headers
 * (imports + interfaces) and tiny structural blocks — generate a long tail
 * of low-quality pairs because their shape generalises too easily. After
 * `dropLowSemanticEvidence`, the worst are gone but e.g. a 12-line file
 * header window can still pair with 14 other headers across the repo.
 * Capping per-fragment caps that tail without touching the score formula.
 *
 * Apply after `sortCandidates`: pairs are visited highest-combined-first,
 * so the survivors of the cap are each fragment's strongest associates.
 * The cap fires when EITHER side of a pair has already reached its
 * budget — a fragment that paired three times can no longer drag in new
 * counterparts, even if those counterparts have budget left.
 *
 * `MAX_PAIRS_PER_FRAGMENT = 3` was picked from the per-fragment pair-count
 * distribution observed on this repo's HEAD~10..HEAD output: 79% of
 * fragments appeared in ≤ 2 pairs (typical legit clone clusters), with a
 * sharp transition into a noise-dominated tail at ≥ 5. See
 * `docs/plans/tuning-tokenNgramSizes.md`.
 */
const MAX_PAIRS_PER_FRAGMENT = 3;

export function capPerFragmentPairs(
  pairs: readonly ScoredPair[],
): ScoredPair[] {
  const counts = new Map<string, number>();
  const out: ScoredPair[] = [];
  for (const pair of pairs) {
    const a = pair.changedFragment.id;
    const b = pair.baseFragment.id;
    if (
      (counts.get(a) ?? 0) >= MAX_PAIRS_PER_FRAGMENT ||
      (counts.get(b) ?? 0) >= MAX_PAIRS_PER_FRAGMENT
    ) {
      continue;
    }
    counts.set(a, (counts.get(a) ?? 0) + 1);
    counts.set(b, (counts.get(b) ?? 0) + 1);
    out.push(pair);
  }
  return out;
}
