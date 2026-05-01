/**
 * Per-node metric record produced by `computeMetrics(graph)`.
 *
 * Every numeric field is computed independently from the graph alone —
 * no I/O, no TypeChecker. Both unweighted (edge count) and weighted
 * (sum of `EDGE_WEIGHTS[kind]`) variants of fan-in/fan-out are kept so
 * downstream scoring can report which one drove a candidate.
 *
 * Betweenness lives on the same record (filled in by M3); the value is
 * `0` until that pass runs, which keeps M2's shape stable.
 */

export interface NodeMetrics {
  /** Number of incoming edges (count, ignores `EDGE_WEIGHTS`). */
  readonly fanInUnweighted: number;
  /** Sum of `EDGE_WEIGHTS[kind]` over incoming edges. */
  readonly fanInWeighted: number;
  /** Number of outgoing edges (count). */
  readonly fanOutUnweighted: number;
  /** Sum of `EDGE_WEIGHTS[kind]` over outgoing edges. */
  readonly fanOutWeighted: number;
  /**
   * Number of distinct ancestors that can reach this node by following
   * directed edges (transitive closure of the reverse graph). The node
   * itself is excluded.
   */
  readonly reverseClosure: number;
  /**
   * PageRank score in `[0, 1]`, summing to ~1 across all nodes.
   * Computed on the weighted directed graph; isolated / sink mass is
   * redistributed uniformly per the standard random-surfer formulation.
   */
  readonly pageRank: number;
  /**
   * Robert C. Martin's instability metric `I = Ce / (Ca + Ce)` —
   * unweighted edge counts, range `[0, 1]`. Nodes with no incident
   * edges are reported as `0` (stable, but trivially so).
   */
  readonly instability: number;
  /**
   * Number of outgoing edges where the target's instability is higher
   * than the source's. Each such edge violates the Stable-Dependencies
   * Principle (a stable component depending on a less-stable one).
   */
  readonly unstableEdgeCount: number;
  /**
   * `unstableEdgeCount / fanOutUnweighted`, or `0` when the source has
   * no outgoing edges.
   */
  readonly unstableEdgeRatio: number;
  /**
   * Largest positive `I(target) - I(source)` across this node's
   * outgoing edges. `0` when no outgoing edge violates SDP. The
   * "instability_delta" axis used in the
   * `unstable_dependency_candidate` smell.
   */
  readonly instabilityDelta: number;
  /**
   * Brandes betweenness centrality. Filled in by M3; stays `0` after
   * M2 only.
   */
  readonly betweenness: number;
}

/** Component-id → metrics. `Map` so iteration order is insertion order. */
export type MetricsRecord = ReadonlyMap<string, NodeMetrics>;

export const ZERO_METRICS: NodeMetrics = {
  fanInUnweighted: 0,
  fanInWeighted: 0,
  fanOutUnweighted: 0,
  fanOutWeighted: 0,
  reverseClosure: 0,
  pageRank: 0,
  instability: 0,
  unstableEdgeCount: 0,
  unstableEdgeRatio: 0,
  instabilityDelta: 0,
  betweenness: 0,
};
