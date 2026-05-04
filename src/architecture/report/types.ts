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
 *    breakdown for the top-listed smell, dismissalId.
 *  - **verbose** (`--verbose`): adds `edgeMix` per hotspot (raw
 *    fanIn/fanOut counts and runtime-edge share) and the project-level
 *    summary (per-smell counts of top-listed hits, candidate count,
 *    ref).
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

interface ArchProject {
  /** Number of `.ts/.tsx` source files contributing to the graph. */
  sourceFileCount: number;
  /** Number of exported components in the graph. Verbose only. */
  componentCount?: number;
}

interface ArchRef {
  /** `file:line` coordinate of the export's defining declaration. */
  location: string;
  /** Export kind (`function`, `class`, `const`, `type`, `interface`, `enum`, `default`). */
  kind: string;
  /** Export name (`"default"` for default exports). */
  name: string;
}

interface ArchScore {
  axis: "composite";
  value: number;
}

export interface ArchContributingMetric {
  axis: string;
  /** Raw axis value (e.g. fan-in count, betweenness centrality). */
  value: number;
  /** Position in the per-axis distribution, in `0..1`. `0` for flag axes. */
  percentile: number;
  /**
   * Population z-score. `0` for flag axes or uniform distributions.
   * Lets the agent distinguish "barely above threshold" from "extreme
   * outlier" when the percentile alone (e.g. `0.99`) hides the shape
   * of the distribution.
   */
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
  /** Verbose only — raw fanIn/fanOut counts and runtime-edge share. */
  edgeMix?: ArchEdgeMix;
  dismissalId: string;
}

interface ArchDiffInfo {
  baseSha: string;
  headSha: string;
  threeDot: boolean;
  changedFiles: number;
}

interface ArchNotice {
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
