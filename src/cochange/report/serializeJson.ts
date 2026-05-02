/**
 * Convert a gated + sorted candidate list into the public cochange report
 * shape. Pure function; the result is what `--format json` prints verbatim
 * and what the Markdown body fence wraps.
 *
 * Slim by default (mirrors dup's two-tier shape). Verbose re-attaches the
 * confidence denominators (`changesOfA` / `changesOfB`), the full SHA list
 * (currently aliasing `recentCommits` because M2's walker caps at 5), the
 * first/last SHA of the surviving window, and a project-level `summary`
 * with the window stats and gate pair counts.
 */

import type { ReportTool } from "../../schema.ts";
import type { Candidate } from "../ranking/types.ts";
import { computeCochangePairDismissalId } from "./dismissalId.ts";
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
}

export interface SerializeOptions {
  verbose: boolean;
}

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

  if (opts.verbose) {
    const out: SerializedCochangeReportVerbose = {
      tool: input.tool,
      project,
      hotspots: input.candidates.map((c) => toVerboseHotspot(c, input)),
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
    hotspots: input.candidates.map(toSlimHotspot),
  };
  return out;
}

function toSlimHotspot(candidate: Candidate): SlimCochangeHotspot {
  return {
    kind: "cochange",
    size: 2,
    score: { axis: "confidenceMax", value: candidate.metrics.confidenceMax },
    members: [{ ref: toRef(candidate.pathA) }, { ref: toRef(candidate.pathB) }],
    metrics: {
      support: candidate.metrics.support,
      confidenceAtoB: candidate.metrics.confidenceAtoB,
      confidenceBtoA: candidate.metrics.confidenceBtoA,
      confidenceMax: candidate.metrics.confidenceMax,
      lift: candidate.metrics.lift,
    },
    evidence: { recentCommits: [...candidate.recent] },
    dismissalId: computeCochangePairDismissalId(
      candidate.pathA,
      candidate.pathB,
    ),
  };
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

function toRef(location: string): CochangeHotspotRef {
  return { location, kind: "file" };
}
