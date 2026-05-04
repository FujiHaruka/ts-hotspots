/**
 * Collapse a sorted pair list into a mix of pair rows and cluster rows for
 * display. The walker, metrics, gate, and sort are all pair-only — this is
 * a pure post-sort transform that detects dense connected components and
 * emits them as a single row, so one logical insight does not occupy
 * `C(N, 2)` slots in the top-N report.
 *
 * Pure function. Deterministic for a given input order. Not invoked in
 * single-anchor mode (`--file <path>`) because the user has explicitly
 * pinned a pair-centric view; collapsing would obscure per-partner
 * metrics.
 *
 * Cluster detection rule:
 *   1. Build the undirected graph whose nodes are file paths and whose
 *      edges are the gated pairs.
 *   2. Find connected components.
 *   3. A component is a cluster iff `nodes >= 3` AND
 *      `edges / C(nodes, 2) >= CLUSTER_DENSITY_FLOOR` (= 0.5). Triangles
 *      and squares qualify; path-like (4-node line) does not. Hub-only
 *      stars (1 central + N leaves, density < 0.5 once N >= 3) stay as
 *      individual pair rows — they are central-file amplification, not
 *      clusters.
 *   4. Cluster row's sort position = the position of its highest-scoring
 *      constituent pair (the first one encountered during the input walk
 *      thanks to upstream sort).
 *
 * Aggregated metrics on a cluster row use median for support and lift
 * (representative — max is dominated by outliers, min is an undercount)
 * and max for `confidenceMax` (the strongest directional probability in
 * the cluster). The `recent` SHA list is the union across pairs,
 * deduped on first occurrence so newer SHAs from the highest-scoring
 * pair surface first.
 */

import type { Candidate } from "../ranking/types.ts";

const CLUSTER_DENSITY_FLOOR = 0.5;
const CLUSTER_MIN_NODES = 3;

export interface ClusterCandidate {
  /** Lex-sorted member file paths. Stable identity for dismissalId. */
  members: string[];
  /** Constituent pairs in input order (highest-scoring first). */
  pairs: readonly Candidate[];
  /** Median of `pair.metrics.support` across constituent pairs. */
  supportMedian: number;
  /** Max of `pair.metrics.confidenceMax` across constituent pairs. */
  confidenceMaxOverall: number;
  /** Median of `pair.metrics.lift` across constituent pairs. */
  liftMedian: number;
  /**
   * Sort key the cluster contributes to the report. Equals the max
   * `support * confidenceMax` across constituent pairs — i.e. the score
   * of the strongest pair in the cluster, so the cluster lands where
   * that pair would have landed.
   */
  scoreMax: number;
  /**
   * Union of `pair.recent` arrays, deduped first-occurrence. Newer SHAs
   * from the highest-scoring pair come first; SHAs unique to weaker
   * pairs follow in input-pair order.
   */
  recentUnion: string[];
}

export type ClusterRow =
  | { kind: "pair"; candidate: Candidate }
  | { kind: "cluster"; cluster: ClusterCandidate };

export function collapseClusters(
  candidates: readonly Candidate[],
): ClusterRow[] {
  if (candidates.length === 0) return [];

  // Adjacency map: file path -> set of partner file paths.
  const adj = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (!adj.has(c.pathA)) adj.set(c.pathA, new Set());
    if (!adj.has(c.pathB)) adj.set(c.pathB, new Set());
    adj.get(c.pathA)?.add(c.pathB);
    adj.get(c.pathB)?.add(c.pathA);
  }

  // Connected components via BFS.
  const componentId = new Map<string, number>();
  let nextId = 0;
  for (const [node] of adj) {
    if (componentId.has(node)) continue;
    const id = nextId++;
    const queue: string[] = [node];
    while (queue.length > 0) {
      const cur = queue.pop();
      if (cur === undefined || componentId.has(cur)) continue;
      componentId.set(cur, id);
      const neighbours = adj.get(cur);
      if (neighbours === undefined) continue;
      for (const n of neighbours) {
        if (!componentId.has(n)) queue.push(n);
      }
    }
  }

  // Group candidates by component.
  const componentPairs = new Map<number, Candidate[]>();
  const componentNodes = new Map<number, Set<string>>();
  for (const c of candidates) {
    const id = componentId.get(c.pathA);
    if (id === undefined) continue;
    if (!componentPairs.has(id)) componentPairs.set(id, []);
    if (!componentNodes.has(id)) componentNodes.set(id, new Set());
    componentPairs.get(id)?.push(c);
    componentNodes.get(id)?.add(c.pathA);
    componentNodes.get(id)?.add(c.pathB);
  }

  // Decide which components qualify as clusters.
  const clusterByComponent = new Map<number, ClusterCandidate>();
  for (const [id, pairs] of componentPairs) {
    const nodes = componentNodes.get(id);
    if (nodes === undefined) continue;
    if (nodes.size < CLUSTER_MIN_NODES) continue;
    const maxEdges = (nodes.size * (nodes.size - 1)) / 2;
    const density = pairs.length / maxEdges;
    if (density < CLUSTER_DENSITY_FLOOR) continue;
    clusterByComponent.set(id, buildCluster(pairs, nodes));
  }

  // Walk the input in order; emit cluster rows at their first-pair
  // position, drop subsequent pairs that belong to an already-emitted
  // cluster, and pass through pairs not in any cluster.
  const emittedClusters = new Set<number>();
  const out: ClusterRow[] = [];
  for (const c of candidates) {
    const id = componentId.get(c.pathA);
    if (id === undefined) {
      out.push({ kind: "pair", candidate: c });
      continue;
    }
    const cluster = clusterByComponent.get(id);
    if (cluster === undefined) {
      out.push({ kind: "pair", candidate: c });
      continue;
    }
    if (!emittedClusters.has(id)) {
      emittedClusters.add(id);
      out.push({ kind: "cluster", cluster });
    }
  }
  return out;
}

function buildCluster(
  pairs: readonly Candidate[],
  nodes: ReadonlySet<string>,
): ClusterCandidate {
  const members = [...nodes].sort();
  const supports = pairs.map((p) => p.metrics.support);
  const lifts = pairs.map((p) => p.metrics.lift);
  const confidenceMaxes = pairs.map((p) => p.metrics.confidenceMax);
  const scores = pairs.map((p) => p.metrics.support * p.metrics.confidenceMax);
  const recentUnion = unionRecent(pairs);
  return {
    members,
    pairs,
    supportMedian: median(supports),
    confidenceMaxOverall: Math.max(...confidenceMaxes),
    liftMedian: median(lifts),
    scoreMax: Math.max(...scores),
    recentUnion,
  };
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  const lo = sorted[mid - 1] ?? 0;
  const hi = sorted[mid] ?? 0;
  return (lo + hi) / 2;
}

function unionRecent(pairs: readonly Candidate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    for (const sha of p.recent) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      out.push(sha);
    }
  }
  return out;
}
