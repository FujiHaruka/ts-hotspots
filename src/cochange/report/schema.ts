/**
 * Output schema emitted by `ts-hotspots cochange`. Mirrors the slim/verbose
 * pattern used by `dup`'s `serializeReport` family: an envelope (`tool`,
 * `project`, `hotspots[]`, optional `diff` / `dismissed` / `summary`) plus
 * a per-hotspot card (`anchor?`, `members[]`, `metrics`, `evidence`,
 * `dismissalId`).
 *
 * The unit of analysis is a file pair. The pair is materialised in the
 * schema using dup's `anchor?` + `members[]` shape so consumers branch on
 * the same keys across subcommands. In whole-repo mode (M4/M5/M6) `anchor`
 * is omitted and `members` carries the lex-ordered pair (length 2). In
 * single-anchor mode (M7) `anchor` carries the pinned file and `members`
 * shrinks to the partner (length 1).
 */

import type { DiffInfo, DismissedSummary, ReportTool } from "../../schema.ts";

export interface CochangeHotspotRef {
  /** Repo-root-relative POSIX path. No `:line` range — cochange is file-level. */
  location: string;
  kind: "file";
}

interface CochangeScore {
  /**
   * Sort key surfaced as the headline score. Equals
   * `support × confidenceMax` — the same composite
   * `src/cochange/ranking/sort.ts` orders candidates by, so JSON ordering
   * and `score.value` ordering agree. The component metrics live in
   * `metrics.support` / `metrics.confidenceMax`.
   */
  axis: "supportConfidence";
  value: number;
}

interface SlimCochangePairMetrics {
  /**
   * For pair rows: raw co-change count.
   * For cluster rows: median of the constituent pairs' supports.
   */
  support: number;
  /** Pair rows only; cluster rows leave this at 0 (semantic does not transfer). */
  confidenceAtoB: number;
  /** Pair rows only; cluster rows leave this at 0 (semantic does not transfer). */
  confidenceBtoA: number;
  /**
   * For pair rows: `max(confidenceAtoB, confidenceBtoA)`.
   * For cluster rows: max of the constituent pairs' `confidenceMax`.
   */
  confidenceMax: number;
  /**
   * For pair rows: above-chance multiplier for the pair.
   * For cluster rows: median of the constituent pairs' lifts.
   */
  lift: number;
}

interface VerboseCochangePairMetrics extends SlimCochangePairMetrics {
  /**
   * Total commits touching A in the window (denominator for confidenceAtoB).
   * Pair rows only; cluster rows omit this (no canonical A/B side).
   */
  changesOfA?: number;
  /**
   * Total commits touching B in the window (denominator for confidenceBtoA).
   * Pair rows only; cluster rows omit this (no canonical A/B side).
   */
  changesOfB?: number;
}

interface SlimCochangeEvidence {
  /**
   * Up to the 5 most recent commits (short SHAs, newest → oldest) where
   * both files were touched. This is a display cap, not a walker cap —
   * agents wanting the full list should pass `--verbose` and read
   * `allCoChangeCommits`.
   */
  recentCommits: string[];
}

interface VerboseCochangeEvidence extends SlimCochangeEvidence {
  /**
   * Every commit (short SHA, newest → oldest) where both files were
   * touched. Length matches `metrics.support`.
   */
  allCoChangeCommits: string[];
  /**
   * First and last SHA in the full co-change list (newest and oldest).
   * Lets the agent re-derive the metric without re-walking the entire
   * window. Absent when the pair has zero recorded commits.
   */
  coChangeWindow?: { firstSha: string; lastSha: string };
}

export interface SlimCochangeHotspot {
  kind: "cochange";
  /**
   * `(anchor ? 1 : 0) + members.length`. `2` for a pair (default and
   * `--file` mode). `>= 3` for a cluster row produced by
   * `collapseClusters` — a dense connected component (density >= 0.5)
   * of co-changing files presented as one row instead of `C(N, 2)`
   * pair rows. Consumers that need to branch on row shape should test
   * `size === 2`.
   */
  size: number;
  score: CochangeScore;
  /** Single-anchor mode only (`--file <path>`); omitted in whole-repo / `--diff`. */
  anchor?: { ref: CochangeHotspotRef };
  /**
   * `2` files when this is a pair row (length 1 in single-anchor mode,
   * length 2 otherwise). `>= 3` files when this is a cluster row, lex
   * sorted; the metrics block then aggregates across the constituent
   * pairs (median support / max confidence / median lift) and
   * `dismissalId` is derived from the lex-sorted member set.
   */
  members: { ref: CochangeHotspotRef }[];
  metrics: SlimCochangePairMetrics;
  evidence: SlimCochangeEvidence;
  /**
   * `coch:<hex>` — `computeCochangePairDismissalId` for pair rows,
   * `computeCochangeClusterDismissalId` for cluster rows. Both share the
   * `coch:` prefix and 16-hex width.
   */
  dismissalId: string;
}

export interface VerboseCochangeHotspot extends SlimCochangeHotspot {
  metrics: VerboseCochangePairMetrics;
  evidence: VerboseCochangeEvidence;
}

interface CochangeProject {
  /** Actual commits the walk consumed (may be < `--window` on shallow clones). */
  windowCommits: number;
  /** TS files in the analysed file-set (post-exclude). */
  analyzedFileCount: number;
  /** Verbose only: pair count before the gate ran. */
  pairCandidateCountBeforeGate?: number;
}

interface CochangeSummary {
  /** Window size requested via `--window`. */
  requestedWindow: number;
  /**
   * Commits the walk actually saw. May be < `requestedWindow` because
   * (a) shallow clone, or (b) merge-heavy history collapses under
   * `git log --first-parent` (PRs that landed as merge commits count
   * as one step). The latter is the common case.
   */
  actualWindow: number;
  /** Commits dropped by `--max-files-per-commit`. */
  commitsSkippedAsLargeChange: number;
  /** Pair count entering the gate. */
  pairsBeforeGate: number;
  /** Pair count surviving the gate (pre-sort, pre-`--limit`). */
  pairsAfterGate: number;
}

export interface SerializedCochangeReport {
  tool: ReportTool;
  project: CochangeProject;
  /** Diff envelope is M6's responsibility; the slot is reserved here. */
  diff?: DiffInfo;
  hotspots: SlimCochangeHotspot[];
  dismissed?: DismissedSummary;
  /** `--verbose` only — see `SerializedCochangeReportVerbose`. */
  summary?: CochangeSummary;
}

export interface SerializedCochangeReportVerbose
  extends SerializedCochangeReport {
  hotspots: VerboseCochangeHotspot[];
  summary: CochangeSummary;
}
