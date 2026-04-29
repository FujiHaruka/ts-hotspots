import type { ReportPair } from "./groupsToPairs.ts";
import type {
  ExpectedNegative,
  ExpectedPositive,
  Range,
} from "./loadFixtures.ts";

export interface PositiveMatch {
  expected: ExpectedPositive;
  /** Index of the earliest matching pair in the report (rank starts at 0). */
  rank: number | null;
  /** Matching pair, if any. */
  candidate: ReportPair | null;
  /** Populated when the candidate matched but `minScore` was violated. */
  minScoreFailure: string | null;
}

export interface NegativeMatch {
  expected: ExpectedNegative;
  /** Number of report candidates that hit the forbidden (file, file) pair. */
  violations: number;
}

export interface MatchResult {
  positives: PositiveMatch[];
  negatives: NegativeMatch[];
}

/**
 * Line-range Jaccard. Both ranges are treated inclusively. When a ground-truth
 * entry omits a range, the overlap defaults to 1.0 (file-path-only match).
 */
function rangeJaccard(
  a: Range,
  b: { startLine: number; endLine: number },
): number {
  if (a.startLine === undefined || a.endLine === undefined) return 1;
  const aStart = a.startLine;
  const aEnd = a.endLine;
  const bStart = b.startLine;
  const bEnd = b.endLine;
  const interStart = Math.max(aStart, bStart);
  const interEnd = Math.min(aEnd, bEnd);
  const inter = Math.max(0, interEnd - interStart + 1);
  if (inter === 0) return 0;
  const unionStart = Math.min(aStart, bStart);
  const unionEnd = Math.max(aEnd, bEnd);
  const union = unionEnd - unionStart + 1;
  return inter / union;
}

function candidateMatchesPositive(
  c: ReportPair,
  expected: ExpectedPositive,
  jaccardThreshold: number,
): boolean {
  if (c.left.filePath !== expected.changed.filePath) return false;
  if (c.right.filePath !== expected.existing.filePath) return false;
  const changedOverlap = rangeJaccard(expected.changed, c.left);
  const existingOverlap = rangeJaccard(expected.existing, c.right);
  return (
    changedOverlap >= jaccardThreshold && existingOverlap >= jaccardThreshold
  );
}

function checkMinScore(
  c: ReportPair,
  minScore: ExpectedPositive["minScore"],
): string | null {
  if (!minScore) return null;
  const failures: string[] = [];
  if (
    minScore.combined !== undefined &&
    c.scores.combined < minScore.combined
  ) {
    failures.push(
      `combined=${c.scores.combined.toFixed(3)} < ${String(minScore.combined)}`,
    );
  }
  if (
    minScore.tokenOverlap !== undefined &&
    c.scores.tokenOverlap < minScore.tokenOverlap
  ) {
    failures.push(
      `token=${c.scores.tokenOverlap.toFixed(3)} < ${String(minScore.tokenOverlap)}`,
    );
  }
  if (
    minScore.statementKindSimilarity !== undefined &&
    c.scores.statementKindSimilarity < minScore.statementKindSimilarity
  ) {
    failures.push(
      `statement=${c.scores.statementKindSimilarity.toFixed(3)} < ${String(minScore.statementKindSimilarity)}`,
    );
  }
  if (
    minScore.callOverlap !== undefined &&
    c.scores.callOverlap < minScore.callOverlap
  ) {
    failures.push(
      `call=${c.scores.callOverlap.toFixed(3)} < ${String(minScore.callOverlap)}`,
    );
  }
  return failures.length === 0 ? null : failures.join(", ");
}

export interface MatchOptions {
  jaccardThreshold: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  jaccardThreshold: 0.5,
};

export function matchReport(
  candidates: readonly ReportPair[],
  expectedPositive: readonly ExpectedPositive[],
  expectedNegative: readonly ExpectedNegative[],
  opts: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchResult {
  const positives: PositiveMatch[] = [];
  for (const expected of expectedPositive) {
    let rank: number | null = null;
    let candidate: ReportPair | null = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (c === undefined) continue;
      if (candidateMatchesPositive(c, expected, opts.jaccardThreshold)) {
        rank = i;
        candidate = c;
        break;
      }
    }
    const minScoreFailure =
      candidate === null ? null : checkMinScore(candidate, expected.minScore);
    positives.push({ expected, rank, candidate, minScoreFailure });
  }

  const negatives: NegativeMatch[] = expectedNegative.map((expected) => {
    let violations = 0;
    for (const c of candidates) {
      if (
        c.left.filePath === expected.changed.filePath &&
        c.right.filePath === expected.existing.filePath
      ) {
        violations += 1;
      }
    }
    return { expected, violations };
  });

  return { positives, negatives };
}
