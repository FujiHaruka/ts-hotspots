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
  /**
   * Optional per-edge weight multiplier. Called once per surviving
   * edge with the source/target file paths and the base weight; the
   * returned value replaces the base weight. Used by the downweight
   * config block — absent callback means base weights only.
   */
  readonly edgeWeight?: (params: {
    readonly fromFile: string;
    readonly toFile: string;
    readonly baseWeight: number;
    readonly kind: Edge["kind"];
  }) => number;
}

export function buildAdjacency(
  graph: Graph,
  options: BuildAdjacencyOptions = {},
): Adjacency {
  const includeTypes = options.includeTypes ?? true;
  const weightHook = options.edgeWeight;

  const nodeIds = graph.nodes.map((n) => n.id);
  const indexById = new Map<string, number>();
  const fileById = new Map<string, string>();
  for (let i = 0; i < nodeIds.length; i++) {
    const node = graph.nodes[i];
    if (node === undefined) continue;
    indexById.set(node.id, i);
    fileById.set(node.id, node.filePath);
  }

  const outEdges: AdjacencyEntry[][] = nodeIds.map(() => []);
  const inEdges: AdjacencyEntry[][] = nodeIds.map(() => []);

  for (const edge of graph.edges) {
    if (!includeTypes && edge.kind === "type") continue;
    const fromIdx = indexById.get(edge.from);
    const toIdx = indexById.get(edge.to);
    if (fromIdx === undefined || toIdx === undefined) continue;
    const baseWeight = EDGE_WEIGHTS[edge.kind];
    let weight = baseWeight;
    if (weightHook !== undefined) {
      const fromFile = fileById.get(edge.from) ?? "";
      const toFile = fileById.get(edge.to) ?? "";
      weight = weightHook({ fromFile, toFile, baseWeight, kind: edge.kind });
    }
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
