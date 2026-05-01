/**
 * Output schema emitted by `ts-hotspots architecture`.
 *
 * The internal `ArchCandidate` carries every input axis the scoring
 * layer evaluated; this module narrows it to a coordinate-first shape
 * an AI agent can consume without drowning in metric detail.
 *
 * Two profiles:
 *  - **slim** (default): top-level coordinate, `smells[]` (the smell
 *    types the node tripped, ordered by composite descending — the
 *    first entry is the highest-composite smell), contributing-metric
 *    breakdown for the top-listed smell, edge mix, dismissalId.
 *  - **verbose** (`--verbose`): adds the project-level summary
 *    (per-smell counts of top-listed hits, candidate count, ref).
 *
 * Both profiles share the same envelope (`tool`, `project`,
 * `hotspots[]`, `dismissed?`, `notice?`, `diff?`, `summary?`) so an
 * agent can branch on the extra detail keys, not on the top-level
 * shape.
 */

import type { DismissedSummary } from "../../schema.ts";
import type { SmellType } from "../ranking/types.ts";

export interface ArchTool {
  name: "ts-hotspots";
  version: string;
}

export interface ArchProject {
  /** Number of `.ts/.tsx` source files contributing to the graph. */
  sourceFileCount: number;
  /** Number of exported components in the graph. Verbose only. */
  componentCount?: number;
}

export interface ArchRef {
  /** `file:line` coordinate of the export's defining declaration. */
  location: string;
  /** Export kind (`function`, `class`, `const`, `type`, `interface`, `enum`, `default`). */
  kind: string;
  /** Export name (`"default"` for default exports). */
  name: string;
}

export interface ArchScore {
  axis: "composite";
  value: number;
}

export interface ArchContributingMetric {
  axis: string;
  weight: number;
  value: number;
  percentile: number;
  /** 1-based rank from the top (`1` = highest). `0` for flag axes. */
  rank: number;
  /** `percentile - threshold`. `0` for flag axes. */
  thresholdDelta: number;
  /** Population z-score. `0` for flag axes or uniform distributions. */
  zScore: number;
}

export interface ArchEdgeMix {
  /** Total outgoing edge count (kind-agnostic). */
  fanOut: number;
  /** Total incoming edge count. */
  fanIn: number;
  /**
   * Fraction of incident edges (in + out) that are runtime (i.e. not
   * `kind: "type"`). Useful as an at-a-glance signal of whether the
   * component is type-only-load-bearing or whether real call sites
   * point at it. `0` when the node has no incident edges.
   */
  runtimeShare: number;
}

export interface ArchHotspot {
  kind: "architecture";
  ref: ArchRef;
  score: ArchScore;
  /**
   * Smell types this node tripped, ordered by composite descending.
   * The first entry is the highest-composite smell — `score.value` and
   * `metrics` correspond to it.
   */
  smells: SmellType[];
  metrics: ArchContributingMetric[];
  edgeMix: ArchEdgeMix;
  dismissalId: string;
}

export interface ArchDiffInfo {
  baseSha: string;
  headSha: string;
  threeDot: boolean;
  changedFiles: number;
}

export interface ArchNotice {
  code: "DIFF_SCOPE_EMPTY";
  message: string;
}

export interface ArchSummary {
  /** Total candidates emitted by the scoring layer (pre-`--limit`). */
  candidateCount: number;
  /**
   * Per-smell counts of top-listed hits — i.e. the first entry of
   * each hotspot's `smells[]` array. Always present, even when 0.
   */
  smellCounts: Record<SmellType, number>;
  /** `--ref` value used to build the graph; `"working-tree"` when none. */
  ref: string;
}

export interface ArchReport {
  tool: ArchTool;
  project: ArchProject;
  hotspots: ArchHotspot[];
  diff?: ArchDiffInfo;
  notice?: ArchNotice;
  dismissed?: DismissedSummary;
  /** `--verbose` only. */
  summary?: ArchSummary;
}

export interface ArchErrorReport {
  status: "error";
  tool: ArchTool;
  error: { code: string; message: string };
}
