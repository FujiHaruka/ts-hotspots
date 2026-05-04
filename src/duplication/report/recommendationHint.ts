import type { Config } from "../config/config.ts";
import type { CandidateScore } from "../domain/candidate.ts";
import { type Fragment, fragmentLineCount } from "../domain/fragment.ts";
import type { Evidence, RecommendationHint } from "../domain/report.ts";

interface DeriveHintArgs {
  score: CandidateScore;
  evidence: Evidence;
  changed: Fragment;
  base: Fragment;
  thresholds: Config["scoring"]["thresholds"];
  /**
   * Whether the changed-side fragment is a "thin wrapper" (see
   * `isThinWrapperFragment`). Defaults to `false` when the caller did
   * not run the judgement.
   */
  changedIsThinWrapper?: boolean;
  /** Same as `changedIsThinWrapper`, for the base side. */
  baseIsThinWrapper?: boolean;
}

const EXTRACT_FUNCTION_TOKEN = 0.7;
const EXTRACT_FUNCTION_STATEMENT = 0.7;
const EXTRACT_FUNCTION_SIZE = 0.6;

const PARAMETERIZE_CALL = 0.5;
const PARAMETERIZE_STATEMENT = 0.5;

const CONFIDENCE_HIGH = 0.7;
const CONFIDENCE_MEDIUM = 0.4;

const SIZE_MISMATCH_RATIO = 1 / 3;
const THRESHOLD_BASED_COMBINED_MAX = 0.3;

/**
 * Derive the `RecommendationHint` block for a single candidate pair.
 *
 * The classification rules are deliberately simple (v1) — they are meant
 * to be fine-tuned against real data in later milestones. See the M6 plan
 * for the full specification.
 */
export function deriveHint(args: DeriveHintArgs): RecommendationHint {
  const {
    score,
    evidence,
    changed,
    base,
    thresholds,
    changedIsThinWrapper = false,
    baseIsThinWrapper = false,
  } = args;
  const { combined, breakdown } = score;

  const confidence: RecommendationHint["confidence"] =
    combined >= CONFIDENCE_HIGH
      ? "high"
      : combined >= CONFIDENCE_MEDIUM
        ? "medium"
        : "low";

  const likelyRefactoring: RecommendationHint["likelyRefactoring"] =
    breakdown.tokenOverlap >= EXTRACT_FUNCTION_TOKEN &&
    breakdown.statementKindSimilarity >= EXTRACT_FUNCTION_STATEMENT &&
    breakdown.sizeCompatibility >= EXTRACT_FUNCTION_SIZE
      ? "extract-function"
      : breakdown.callOverlap >= PARAMETERIZE_CALL &&
          breakdown.statementKindSimilarity >= PARAMETERIZE_STATEMENT
        ? "parameterize"
        : "manual-review";

  const riskFlags: string[] = [];

  const changedSize = fragmentLineCount(changed);
  const baseSize = fragmentLineCount(base);
  if (changedSize > 0 && baseSize > 0) {
    const ratio =
      Math.min(changedSize, baseSize) / Math.max(changedSize, baseSize);
    if (ratio < SIZE_MISMATCH_RATIO) {
      riskFlags.push("size-mismatch");
    }
  }

  if (
    evidence.sharedCalls.length === 0 &&
    evidence.sharedProperties.length === 0
  ) {
    riskFlags.push("low-semantic-evidence");
  }

  if (combined < THRESHOLD_BASED_COMBINED_MAX) {
    const passedIndividual =
      breakdown.tokenOverlap >= thresholds.token ||
      breakdown.statementKindSimilarity >= thresholds.statement ||
      breakdown.callOverlap >= thresholds.call;
    if (passedIndividual) {
      riskFlags.push("threshold-based");
    }
  }

  if (changed.filePath === base.filePath) {
    riskFlags.push("same-file");
  }

  // Both-side thin-wrapper pairs are dropped upstream by
  // `dropThinWrapperPairs`, so by the time we get here only XOR cases
  // can flag this. The flag tells reviewers that one side is a thin
  // wrapper whose match against an unrelated implementation is suspect
  // (likely already-DRYed component on one side, hand-written on the
  // other).
  if (changedIsThinWrapper !== baseIsThinWrapper) {
    riskFlags.push("thin-wrapper-side");
  }

  riskFlags.sort();

  return {
    confidence,
    likelyRefactoring,
    riskFlags,
  };
}
