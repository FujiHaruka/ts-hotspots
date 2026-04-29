import type { ScoredPair } from "./jsonReport.ts";

/**
 * Drop pairs that pair on structural signal alone (token n-grams + statement
 * kinds) without any shared call or property access.
 *
 * The OR-based `shouldReport` decision favours recall: a pair clears report
 * if any axis exceeds its threshold. In practice that promotes a lot of
 * shape-only matches — runs of `for`/`if` blocks with similar token bags but
 * no overlapping API surface. When `intersections.calls` (which holds both
 * `CALL:` and `PROP:` keys, see `evidence.ts`) is empty, the pair has no
 * semantic anchor a reviewer can use to judge it. We require some other
 * compensating evidence to keep it:
 *
 * - `combined` at or above `COMBINED_FLOOR`, AND
 * - `tokenOverlap` at or above `TOKEN_FLOOR`.
 *
 * A pair missing both compensations is the FP class observed in
 * `docs/plans/tuning-tokenNgramSizes.md`: `combined ≈ 0.4` carried entirely
 * by `statementKindSimilarity = 1.0` while `tokenOverlap < 0.2` and
 * `callOverlap = 0`. These survived the previous combined-only floor.
 */
const COMBINED_FLOOR = 0.4;
const TOKEN_FLOOR = 0.2;

export function dropLowSemanticEvidence(
  pairs: readonly ScoredPair[],
): ScoredPair[] {
  const out: ScoredPair[] = [];
  for (const pair of pairs) {
    if (
      pair.intersections.calls.length === 0 &&
      (pair.score.combined < COMBINED_FLOOR ||
        pair.score.breakdown.tokenOverlap < TOKEN_FLOOR)
    ) {
      continue;
    }
    out.push(pair);
  }
  return out;
}
