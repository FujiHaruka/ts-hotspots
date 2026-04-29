import type { CloneGroup } from "./cloneGroup.ts";

export interface Evidence {
  sharedCalls: string[];
  sharedProperties: string[];
  matchedStatementKinds: string[];
  matchedTokenNgramsSample: string[];
}

export interface RecommendationHint {
  confidence: "low" | "medium" | "high";
  likelyRefactoring: "extract-function" | "parameterize" | "manual-review";
  riskFlags: string[];
}

/** Per-side counts describing the input that was actually scanned. */
export interface ScopeStats {
  files: number;
  lines: number;
  fragments: number;
  fragmentsByKind: {
    function: number;
    block: number;
    window: number;
  };
  /**
   * `.ts` / `.tsx` files that were dropped by `config.exclude.globs`. Files
   * without a TypeScript extension are not counted here.
   */
  excludedFiles: number;
}

export interface AnalysisSummary {
  /** `"pr"` for revrange runs, `"whole-repo"` for full-tree scans. */
  mode: "pr" | "whole-repo";
  scope: {
    /**
     * In PR mode this describes the base-side codebase. In whole-repo
     * mode it describes the entire scanned tree (the only set in play).
     * The `mode` field above disambiguates.
     */
    base: ScopeStats;
    /** PR mode only: stats for the head-side changed fragments. */
    changed?: ScopeStats;
  };
  pipeline: {
    /** Raw candidate pairs returned by `searchCandidates` before scoring. */
    candidatePairs: number;
    /** Pairs that cleared `shouldReport` thresholds (pre-collapse). */
    reportedPairs: number;
  };
}

export interface CloneCandidateReport {
  pr: {
    baseSha: string;
    headSha: string;
  };
  summary: AnalysisSummary;
  groups: CloneGroup[];
}
