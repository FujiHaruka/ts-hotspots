/**
 * Convert internal architecture results — graph + metrics + ranked
 * candidates — into the public output schema. Pure function; the
 * serialised report is what `--format json` prints verbatim and what
 * the Markdown body fence wraps.
 *
 * The serialiser owns three responsibilities the rest of the pipeline
 * deliberately does not:
 *
 * 1. Pick the `file:line` coordinate, assemble the export name + kind
 *    string from the component id, and compute `dismissalId` so each
 *    hotspot is a self-contained agent-facing card.
 * 2. Compute the at-a-glance edge mix (`fanIn`/`fanOut`/`runtimeShare`)
 *    per node — verbose only — so the report shows raw connectivity
 *    without forcing the agent to re-walk the graph.
 * 3. Flatten the scoring layer's primary + secondary smells into a
 *    single `smells[]` list ordered by composite descending, and
 *    filter slim vs verbose (slim drops `edgeMix`, `summary`, and
 *    `componentCount`).
 */

import { componentIdToArchDismissalId } from "../../dismissal/hash.ts";
import type { Component, Edge, Graph } from "../graph/types.ts";
import { SMELL_TYPES, type SmellType } from "../ranking/types.ts";
import type { ArchCandidate } from "../scoring/score.ts";
import type {
  ArchContributingMetric,
  ArchEdgeMix,
  ArchHotspot,
  ArchReport,
  ArchSummary,
  ArchTool,
} from "./types.ts";

export interface SerializeOptions {
  readonly tool: ArchTool;
  readonly verbose: boolean;
  readonly ref: string;
  readonly graph: Graph;
  readonly sourceFileCount: number;
}

export function serializeReport(
  candidates: readonly ArchCandidate[],
  opts: SerializeOptions,
): ArchReport {
  const componentById = new Map<string, Component>();
  for (const node of opts.graph.nodes) componentById.set(node.id, node);
  const edgeMixByNode = opts.verbose ? computeEdgeMix(opts.graph) : undefined;

  const hotspots = candidates.map((c) =>
    toHotspot(c, componentById, edgeMixByNode),
  );

  const project: ArchReport["project"] = {
    sourceFileCount: opts.sourceFileCount,
  };
  if (opts.verbose) {
    project.componentCount = opts.graph.nodes.length;
  }

  const report: ArchReport = {
    tool: opts.tool,
    project,
    hotspots,
  };
  if (opts.verbose) {
    report.summary = buildSummary(candidates, opts.ref);
  }
  return report;
}

function toHotspot(
  candidate: ArchCandidate,
  componentById: ReadonlyMap<string, Component>,
  edgeMixByNode: ReadonlyMap<string, ArchEdgeMix> | undefined,
): ArchHotspot {
  const node = componentById.get(candidate.nodeId);
  const ref =
    node === undefined
      ? { location: candidate.nodeId, kind: "unknown", name: "unknown" }
      : {
          location: `${node.filePath}:${String(node.line)}`,
          kind: node.exportKind,
          name: node.exportName,
        };
  const smells: SmellType[] = [
    candidate.primary.smellType,
    ...candidate.secondary.map((s) => s.smellType),
  ];
  const hotspot: ArchHotspot = {
    kind: "architecture",
    ref,
    score: { axis: "composite", value: candidate.primary.composite },
    smells,
    metrics: candidate.primary.contributing.map(toContributingMetric),
    dismissalId: componentIdToArchDismissalId(candidate.nodeId),
  };
  if (edgeMixByNode !== undefined) {
    hotspot.edgeMix = edgeMixByNode.get(candidate.nodeId) ?? {
      fanOut: 0,
      fanIn: 0,
      runtimeShare: 0,
    };
  }
  return hotspot;
}

function toContributingMetric(c: {
  axis: string;
  value: number;
  percentile: number;
  zScore: number;
}): ArchContributingMetric {
  return {
    axis: c.axis,
    value: c.value,
    percentile: c.percentile,
    zScore: c.zScore,
  };
}

function buildSummary(
  candidates: readonly ArchCandidate[],
  ref: string,
): ArchSummary {
  const counts: Record<SmellType, number> = {
    architectural_hub: 0,
    high_fanout_component: 0,
    high_impact_component: 0,
    bridge_component: 0,
    unstable_dependency_candidate: 0,
    over_shared_component: 0,
  };
  for (const c of candidates) {
    counts[c.primary.smellType] = counts[c.primary.smellType] + 1;
  }
  const ordered: Record<SmellType, number> = {
    architectural_hub: 0,
    high_fanout_component: 0,
    high_impact_component: 0,
    bridge_component: 0,
    unstable_dependency_candidate: 0,
    over_shared_component: 0,
  };
  for (const s of SMELL_TYPES) ordered[s] = counts[s];
  return {
    candidateCount: candidates.length,
    smellCounts: ordered,
    ref,
  };
}

function computeEdgeMix(graph: Graph): Map<string, ArchEdgeMix> {
  interface MutableMix {
    fanOut: number;
    fanIn: number;
    runtimeIncident: number;
  }
  const mix = new Map<string, MutableMix>();
  for (const node of graph.nodes) {
    mix.set(node.id, { fanOut: 0, fanIn: 0, runtimeIncident: 0 });
  }
  for (const edge of graph.edges) {
    const isRuntime = edge.kind !== "type";
    bump(mix, edge.from, "fanOut", isRuntime);
    bump(mix, edge.to, "fanIn", isRuntime);
  }
  const result = new Map<string, ArchEdgeMix>();
  for (const [id, m] of mix) {
    const incident = m.fanOut + m.fanIn;
    result.set(id, {
      fanOut: m.fanOut,
      fanIn: m.fanIn,
      runtimeShare: incident === 0 ? 0 : m.runtimeIncident / incident,
    });
  }
  return result;
}

function bump(
  mix: Map<string, { fanOut: number; fanIn: number; runtimeIncident: number }>,
  id: string,
  axis: "fanOut" | "fanIn",
  isRuntime: boolean,
): void {
  const cur = mix.get(id);
  if (cur === undefined) return;
  cur[axis] += 1;
  if (isRuntime) cur.runtimeIncident += 1;
}

// Helper kept exported for unit tests that want to assert the
// per-edge-kind tagging without going through the full serialiser.
export function _internalEdgeKindIsRuntime(edge: Edge): boolean {
  return edge.kind !== "type";
}
