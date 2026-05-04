import type {
  AnalysisSummary,
  ScopeStats,
} from "../../../src/duplication/domain/report.ts";

/**
 * Zero-filled `ScopeStats` for tests that don't exercise the analysis
 * summary itself but still need to satisfy the report shape.
 */
const STUB_SCOPE_STATS: ScopeStats = {
  files: 0,
  lines: 0,
  fragments: 0,
  fragmentsByKind: { function: 0, block: 0, window: 0 },
  excludedFiles: 0,
};

export const STUB_DIFF_SUMMARY: AnalysisSummary = {
  mode: "diff",
  scope: { base: STUB_SCOPE_STATS, changed: STUB_SCOPE_STATS },
  pipeline: { candidatePairs: 0, reportedPairs: 0 },
};

export const STUB_WHOLE_REPO_SUMMARY: AnalysisSummary = {
  mode: "whole-repo",
  scope: { base: STUB_SCOPE_STATS },
  pipeline: { candidatePairs: 0, reportedPairs: 0 },
};
