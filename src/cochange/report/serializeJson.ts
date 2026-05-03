/**
 * Convert a gated + sorted candidate list into the public cochange report
 * shape. Pure function; the result is what `--format json` prints verbatim
 * and what the Markdown body fence wraps.
 *
 * Slim by default (mirrors dup's two-tier shape). Verbose re-attaches the
 * confidence denominators (`changesOfA` / `changesOfB`), the full SHA list
 * in `allCoChangeCommits` (length === `metrics.support`), the first/last
 * SHA of the full window, and a project-level `summary` with the window
 * stats and gate pair counts.
 */

import type { DiffInfo, ReportTool } from "../../schema.ts";
import type { Candidate } from "../ranking/types.ts";
import {
  type ClusterCandidate,
  type ClusterRow,
  collapseClusters,
} from "./collapseClusters.ts";
import {
  computeCochangeClusterDismissalId,
  computeCochangePairDismissalId,
} from "./dismissalId.ts";
import type {
  CochangeHotspotRef,
  SerializedCochangeReport,
  SerializedCochangeReportVerbose,
  SlimCochangeHotspot,
  VerboseCochangeHotspot,
} from "./schema.ts";

export interface CochangeReportInput {
  /** Gated + sorted, post-`--limit` candidate list. */
  candidates: readonly Candidate[];
  perFileChanges: ReadonlyMap<string, number>;
  windowCommits: number;
  analyzedFileCount: number;
  /** Pair count BEFORE `applyGate`. Verbose-only output. */
  pairCandidateCountBeforeGate: number;
  /** Pair count AFTER `applyGate` but BEFORE sort/limit. Verbose-only output. */
  pairsAfterGate: number;
  commitsSkippedAsLargeChange: number;
  requestedWindow: number;
  actualWindow: number;
  tool: ReportTool;
  /** Diff envelope when `--diff <revrange>` is active; absent otherwise. */
  diff?: DiffInfo;
}

export interface SerializeOptions {
  verbose: boolean;
}

/**
 * Slim/verbose boundary for the recent-commit display. The walker keeps
 * the full list internally; this cap is purely an output decision so the
 * default report stays small for an agent's attention budget.
 */
const RECENT_DISPLAY_CAP = 5;

export function serializeReport(
  input: CochangeReportInput,
  opts: SerializeOptions,
): SerializedCochangeReport | SerializedCochangeReportVerbose {
  const project: SerializedCochangeReport["project"] = {
    windowCommits: input.windowCommits,
    analyzedFileCount: input.analyzedFileCount,
  };
  if (opts.verbose) {
    project.pairCandidateCountBeforeGate = input.pairCandidateCountBeforeGate;
  }

  // Cluster rollup is whole-repo only. In single-anchor mode (`--file`)
  // the user has explicitly asked for a pair-centric view per partner,
  // and aggregating across partners would obscure per-partner metrics.
  const isAnchorMode = input.candidates.some((c) => c.anchor !== undefined);
  const rows: ClusterRow[] = isAnchorMode
    ? input.candidates.map((c) => ({ kind: "pair", candidate: c }))
    : collapseClusters(input.candidates);

  if (opts.verbose) {
    const out: SerializedCochangeReportVerbose = {
      tool: input.tool,
      project,
      hotspots: rows.map((row) => toVerboseHotspotRow(row, input)),
      summary: {
        requestedWindow: input.requestedWindow,
        actualWindow: input.actualWindow,
        commitsSkippedAsLargeChange: input.commitsSkippedAsLargeChange,
        pairsBeforeGate: input.pairCandidateCountBeforeGate,
        pairsAfterGate: input.pairsAfterGate,
      },
    };
    return out;
  }

  const out: SerializedCochangeReport = {
    tool: input.tool,
    project,
    hotspots: rows.map(toSlimHotspotRow),
  };
  return out;
}

function toSlimHotspotRow(row: ClusterRow): SlimCochangeHotspot {
  return row.kind === "pair"
    ? toSlimHotspot(row.candidate)
    : toSlimClusterHotspot(row.cluster);
}

function toVerboseHotspotRow(
  row: ClusterRow,
  input: CochangeReportInput,
): VerboseCochangeHotspot {
  return row.kind === "pair"
    ? toVerboseHotspot(row.candidate, input)
    : toVerboseClusterHotspot(row.cluster);
}

function toSlimHotspot(candidate: Candidate): SlimCochangeHotspot {
  const hotspot: SlimCochangeHotspot = {
    kind: "cochange",
    size: 2,
    score: {
      axis: "supportConfidence",
      value: candidate.metrics.support * candidate.metrics.confidenceMax,
    },
    members: anchoredMembers(candidate),
    metrics: {
      support: candidate.metrics.support,
      confidenceAtoB: candidate.metrics.confidenceAtoB,
      confidenceBtoA: candidate.metrics.confidenceBtoA,
      confidenceMax: candidate.metrics.confidenceMax,
      lift: candidate.metrics.lift,
    },
    evidence: {
      recentCommits: candidate.recent.slice(0, RECENT_DISPLAY_CAP),
    },
    dismissalId: computeCochangePairDismissalId(
      candidate.pathA,
      candidate.pathB,
    ),
  };
  if (candidate.anchor !== undefined) {
    hotspot.anchor = { ref: toRef(candidate.anchor) };
  }
  return hotspot;
}

function anchoredMembers(candidate: Candidate): { ref: CochangeHotspotRef }[] {
  if (candidate.anchor === undefined) {
    return [{ ref: toRef(candidate.pathA) }, { ref: toRef(candidate.pathB) }];
  }
  const partner =
    candidate.anchor === candidate.pathA ? candidate.pathB : candidate.pathA;
  return [{ ref: toRef(partner) }];
}

function toVerboseHotspot(
  candidate: Candidate,
  input: CochangeReportInput,
): VerboseCochangeHotspot {
  const slim = toSlimHotspot(candidate);
  const recent = candidate.recent;
  const verbose: VerboseCochangeHotspot = {
    ...slim,
    metrics: {
      ...slim.metrics,
      changesOfA: input.perFileChanges.get(candidate.pathA) ?? 0,
      changesOfB: input.perFileChanges.get(candidate.pathB) ?? 0,
    },
    evidence: {
      recentCommits: slim.evidence.recentCommits,
      allCoChangeCommits: [...recent],
    },
  };
  if (recent.length > 0) {
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (first !== undefined && last !== undefined) {
      verbose.evidence.coChangeWindow = { firstSha: first, lastSha: last };
    }
  }
  return verbose;
}

function toSlimClusterHotspot(cluster: ClusterCandidate): SlimCochangeHotspot {
  return {
    kind: "cochange",
    size: cluster.members.length,
    score: {
      axis: "supportConfidence",
      value: cluster.scoreMax,
    },
    members: cluster.members.map((m) => ({ ref: toRef(m) })),
    metrics: {
      support: cluster.supportMedian,
      // Pairwise confidence has no meaning at the cluster level; surface
      // the strongest constituent confidenceMax and leave the directional
      // sides at 0 (the schema documents the shift).
      confidenceAtoB: 0,
      confidenceBtoA: 0,
      confidenceMax: cluster.confidenceMaxOverall,
      lift: cluster.liftMedian,
    },
    evidence: {
      recentCommits: cluster.recentUnion.slice(0, RECENT_DISPLAY_CAP),
    },
    dismissalId: computeCochangeClusterDismissalId(cluster.members),
  };
}

function toVerboseClusterHotspot(
  cluster: ClusterCandidate,
): VerboseCochangeHotspot {
  const slim = toSlimClusterHotspot(cluster);
  const verbose: VerboseCochangeHotspot = {
    ...slim,
    // Cluster rows omit changesOfA/changesOfB — there is no canonical
    // A/B side. The schema marks both as optional for this case.
    metrics: { ...slim.metrics },
    evidence: {
      recentCommits: slim.evidence.recentCommits,
      allCoChangeCommits: [...cluster.recentUnion],
    },
  };
  if (cluster.recentUnion.length > 0) {
    const first = cluster.recentUnion[0];
    const last = cluster.recentUnion[cluster.recentUnion.length - 1];
    if (first !== undefined && last !== undefined) {
      verbose.evidence.coChangeWindow = { firstSha: first, lastSha: last };
    }
  }
  return verbose;
}

function toRef(location: string): CochangeHotspotRef {
  return { location, kind: "file" };
}
