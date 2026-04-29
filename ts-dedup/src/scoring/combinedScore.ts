import type { Config } from "../config/config.ts";
import type { ScoreBreakdown } from "../domain/candidate.ts";

/**
 * Weighted sum of the 5 per-axis scores, with defensive weight normalization.
 *
 * The default config sums to 1.0, so normalization is a no-op there. But if
 * a user overrides weights with any positive numbers, we normalize by their
 * sum so that `combined` stays in `[0, 1]` and the thresholds in
 * `config.scoring.thresholds` retain their meaning.
 *
 * When a feature stream is disabled via `enabled`, its weight is dropped from
 * both numerator and denominator — the remaining axes keep their relative
 * proportions and `combined` still lives in `[0, 1]`. `size` and `length`
 * are always on: they are pair-level properties, not feature streams.
 *
 * If all effective weights are 0 (or negative cancel to 0), returns 0.
 */
export function combinedScore(
  breakdown: ScoreBreakdown,
  weights: Config["scoring"]["weights"],
  enabled: Config["features"]["enabled"] = {
    token: true,
    statement: true,
    call: true,
  },
): number {
  const wToken = enabled.token ? weights.token : 0;
  const wStatement = enabled.statement ? weights.statement : 0;
  const wCall = enabled.call ? weights.call : 0;
  const wSize = weights.size;
  const wLength = weights.length;
  const sum = wToken + wStatement + wCall + wSize + wLength;
  if (sum <= 0) {
    return 0;
  }
  return (
    (wToken / sum) * breakdown.tokenOverlap +
    (wStatement / sum) * breakdown.statementKindSimilarity +
    (wCall / sum) * breakdown.callOverlap +
    (wSize / sum) * breakdown.sizeCompatibility +
    (wLength / sum) * breakdown.lengthScore
  );
}
