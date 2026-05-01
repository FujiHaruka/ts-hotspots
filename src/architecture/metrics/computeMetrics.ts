/**
 * Compose every per-node metric into one record keyed by component id.
 *
 * Pure function over the graph + an optional flag for `--include-types`.
 * Order of node ids in the returned `Map` matches `graph.nodes` (the
 * graph's canonical lex-sorted order), so downstream stages that
 * iterate the metrics record see deterministic output without
 * additional sorting.
 *
 * Betweenness is intentionally left at `0`. M3 fills it in via
 * `withBetweenness(metrics, graph, options)` so the heavy
 * Brandes pass stays a separate compose step — that keeps M2 cheap
 * for the small graphs where betweenness is overkill, and lets
 * `--phase-timings` attribute the cost cleanly.
 */

import type { Edge, Graph } from "../graph/types.ts";
import { type Adjacency, buildAdjacency } from "./adjacency.ts";
import { computeFan } from "./fanInOut.ts";
import { computeInstability } from "./instability.ts";
import { computePageRank } from "./pageRank.ts";
import { computeReverseClosure } from "./reverseClosure.ts";
import type { MetricsRecord, NodeMetrics } from "./types.ts";

export interface ComputeMetricsOptions {
  /** Default `true`. Mirrors `--include-types[=false]`. */
  readonly includeTypes?: boolean;
  /**
   * Optional per-edge weight hook. When set, `buildAdjacency` calls
   * this per surviving edge with `{fromFile, toFile, baseWeight, kind}`
   * and uses the return value as the edge weight (replaces
   * `EDGE_WEIGHTS[kind]`). Used by `arch`'s downweight config block —
   * absent hook = base weights only.
   */
  readonly edgeWeight?: (params: {
    readonly fromFile: string;
    readonly toFile: string;
    readonly baseWeight: number;
    readonly kind: Edge["kind"];
  }) => number;
}

export interface MetricsBundle {
  readonly metrics: MetricsRecord;
  /** Adjacency reused by the M3 betweenness pass. */
  readonly adjacency: Adjacency;
}

export function computeMetrics(
  graph: Graph,
  options: ComputeMetricsOptions = {},
): MetricsBundle {
  const adjacency = buildAdjacency(graph, {
    includeTypes: options.includeTypes,
    edgeWeight: options.edgeWeight,
  });

  const reverseClosure = computeReverseClosure(adjacency);
  const pageRank = computePageRank(adjacency);
  const instability = computeInstability(adjacency);

  const result = new Map<string, NodeMetrics>();
  for (let i = 0; i < adjacency.nodeIds.length; i++) {
    const id = adjacency.nodeIds[i] as string;
    const fan = computeFan(adjacency, i);
    const node: NodeMetrics = {
      fanInUnweighted: fan.fanInUnweighted,
      fanInWeighted: fan.fanInWeighted,
      fanOutUnweighted: fan.fanOutUnweighted,
      fanOutWeighted: fan.fanOutWeighted,
      reverseClosure: reverseClosure[i] ?? 0,
      pageRank: pageRank[i] ?? 0,
      instability: instability.instability[i] ?? 0,
      unstableEdgeCount: instability.unstableEdgeCount[i] ?? 0,
      unstableEdgeRatio: instability.unstableEdgeRatio[i] ?? 0,
      instabilityDelta: instability.instabilityDelta[i] ?? 0,
      betweenness: 0,
    };
    result.set(id, node);
  }
  return { metrics: result, adjacency };
}
