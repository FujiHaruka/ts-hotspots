import type { CloneGroup } from "./cloneGroup.ts";

export interface ReportTool {
  name: "ts-hotspots";
  version: string;
}

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
  /** `"diff"` for revrange runs, `"whole-repo"` for full-tree scans. */
  mode: "diff" | "whole-repo";
  scope: {
    /**
     * In diff mode this describes the base-side codebase. In whole-repo
     * mode it describes the entire scanned tree (the only set in play).
     * The `mode` field above disambiguates.
     */
    base: ScopeStats;
    /** Diff mode only: stats for the head-side changed fragments. */
    changed?: ScopeStats;
  };
  pipeline: {
    /** Raw candidate pairs returned by `searchCandidates` before scoring. */
    candidatePairs: number;
    /** Pairs that cleared `shouldReport` thresholds (pre-collapse). */
    reportedPairs: number;
  };
}

/**
 * Dismissal accounting parallel to `comp`'s `DismissedSummary`. Present
 * only when the registry held at least one entry at run time.
 *
 * - `active`: entries still recognised in the post-prune registry.
 * - `filteredThisRun`: groups removed from this run's output because their
 *   id appears in the registry.
 * - `prunedThisRun`: registry entries dropped because their group is no
 *   longer reported (group composition changed → id auto-expired).
 */
export interface DismissedSummary {
  active: number;
  filteredThisRun: number;
  prunedThisRun: number;
}

/**
 * Diff-mode metadata. Mirrors `comp`'s `DiffInfo` so consumers can read
 * the scope of a diff identically across subcommands.
 *
 * In whole-repo mode `diff` still exists internally (`baseSha === headSha`,
 * `threeDot: false`, `changedFiles: 0`) for type stability, but
 * `serializeReport` strips it from the output envelope.
 */
export interface DuplicationDiffInfo {
  baseSha: string;
  headSha: string;
  /** `true` for `A...B` (merge-base semantics). `false` for `A..B`. */
  threeDot: boolean;
  /** Count of `.ts`/`.tsx` files changed between `baseSha` and `headSha`. */
  changedFiles: number;
}

export interface CloneCandidateReport {
  status: "ok";
  tool: ReportTool;
  diff: DuplicationDiffInfo;
  summary: AnalysisSummary;
  groups: CloneGroup[];
  dismissed?: DismissedSummary;
}
