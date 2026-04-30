import type { Config } from "../config/config.ts";
import type { CandidateScore } from "../domain/candidate.ts";

/**
 * OR-based report decision.
 *
 * Recall is favored over precision: a candidate is reported if **any** of the
 * per-axis scores clears its own threshold, or if the combined score clears
 * `thresholds.combined`. See v1.md §7.
 *
 * All comparisons are inclusive (`>=`) so threshold-equal pairs still report.
 *
 * Disabled feature streams (see `config.features.enabled`) are excluded from
 * the OR check — the user's intent is that the axis not participate, and any
 * 0 score there should not be considered a "match".
 */
export function shouldReport(
  score: CandidateScore,
  thresholds: Config["scoring"]["thresholds"],
  enabled: Config["features"]["enabled"] = {
    token: true,
    statement: true,
    call: true,
  },
): boolean {
  if (score.combined >= thresholds.combined) return true;
  if (enabled.token && score.breakdown.tokenOverlap >= thresholds.token) {
    return true;
  }
  if (
    enabled.statement &&
    score.breakdown.statementKindSimilarity >= thresholds.statement
  ) {
    return true;
  }
  if (enabled.call && score.breakdown.callOverlap >= thresholds.call) {
    return true;
  }
  return false;
}
