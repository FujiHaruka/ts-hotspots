/**
 * Shared adjacency precomputation. Every metric in
 * `src/architecture/metrics/` consumes one of:
 *
 * - per-node out-edges (PageRank, instability, unstable-edge ratio)
 * - per-node in-edges (fan-in, reverse closure, betweenness)
 *
 * Building both indices once lets every metric read O(deg(v)) rather
 * than rescanning the full edge list. The `nodeIds` array is the
 * canonical iteration order — `graph.nodes` is already sorted by id,
 * so this preserves determinism.
 *
 * `--include-types=false` is enforced here: edges of kind `"type"` are
 * dropped *before* indexing, so every downstream metric sees a
 * consistent edge set.
 */

import { EDGE_WEIGHTS, type Edge, type Graph } from "../graph/types.ts";

export interface AdjacencyEntry {
  readonly targetIndex: number;
  readonly weight: number;
  readonly kind: Edge["kind"];
}

export interface Adjacency {
  /** `nodeIds[i]` is the id of node `i`. Sorted lex (graph invariant). */
  readonly nodeIds: readonly string[];
  /** Lookup for the inverse mapping. */
  readonly indexById: ReadonlyMap<string, number>;
  /** `outEdges[i]` lists edges leaving node `i` (target indices). */
  readonly outEdges: readonly (readonly AdjacencyEntry[])[];
  /** `inEdges[i]` lists edges entering node `i` (source as targetIndex). */
  readonly inEdges: readonly (readonly AdjacencyEntry[])[];
}

export interface BuildAdjacencyOptions {
  /**
   * When `false`, drops every edge of kind `"type"` before indexing.
   * Default `true`; mirrors the CLI flag `--include-types[=false]`.
   */
  readonly includeTypes?: boolean;
}

export function buildAdjacency(
  graph: Graph,
  options: BuildAdjacencyOptions = {},
): Adjacency {
  const includeTypes = options.includeTypes ?? true;

  const nodeIds = graph.nodes.map((n) => n.id);
  const indexById = new Map<string, number>();
  for (let i = 0; i < nodeIds.length; i++) {
    const node = graph.nodes[i];
    if (node === undefined) continue;
    indexById.set(node.id, i);
  }

  const outEdges: AdjacencyEntry[][] = nodeIds.map(() => []);
  const inEdges: AdjacencyEntry[][] = nodeIds.map(() => []);

  for (const edge of graph.edges) {
    if (!includeTypes && edge.kind === "type") continue;
    const fromIdx = indexById.get(edge.from);
    const toIdx = indexById.get(edge.to);
    if (fromIdx === undefined || toIdx === undefined) continue;
    const weight = EDGE_WEIGHTS[edge.kind];
    if (weight <= 0) continue;
    const out = outEdges[fromIdx];
    const inn = inEdges[toIdx];
    if (out !== undefined) {
      out.push({ targetIndex: toIdx, weight, kind: edge.kind });
    }
    if (inn !== undefined) {
      inn.push({ targetIndex: fromIdx, weight, kind: edge.kind });
    }
  }

  return { nodeIds, indexById, outEdges, inEdges };
}
