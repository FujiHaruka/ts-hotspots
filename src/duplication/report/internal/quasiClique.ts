import { nonNull } from "../../util/nonNull.ts";

/**
 * Greedy quasi-clique extraction over a single connected component.
 *
 * Picks a high-degree seed and grows the cluster by adding neighbors of
 * the seed that keep the running edge density above `minDensity`. The
 * result is one cluster; the caller is expected to remove it from the CC
 * and recurse on the remainder if more clusters might exist.
 *
 * Design notes:
 * - Density = `edges_inside / C(n, 2)`. A cluster of size 1 has density
 *   conventionally treated as 1.0 (no pairs to violate).
 * - Candidate ordering is fully deterministic: degree-desc / id-asc for
 *   seed selection, edge-weight-desc / id-asc for the iteration over
 *   `N(seed)`. The same input therefore returns the same cluster.
 * - Greedy / not optimal. The MaxClique/Quasi-Clique problems are
 *   NP-hard; ts-dedup biases toward recall + downstream judgment, so a
 *   slightly suboptimal split is acceptable.
 */
interface QuasiCliqueInput {
  /** Node ids that make up the connected component (or any subset). */
  nodes: readonly string[];
  /**
   * Symmetric adjacency map: `nodeId → (neighborId → edgeWeight)`. Edges
   * pointing at nodes outside `nodes` are ignored. The weight is used
   * only for ordering — `combined` is the natural choice.
   */
  adjacency: ReadonlyMap<string, ReadonlyMap<string, number>>;
  minDensity: number;
  maxSize: number;
}

export function extractQuasiClique(input: QuasiCliqueInput): string[] {
  const { nodes, adjacency, minDensity, maxSize } = input;
  if (nodes.length === 0) return [];
  if (nodes.length === 1 || maxSize <= 1) return [nonNull(nodes[0])];

  const inSet = new Set(nodes);
  const degree = new Map<string, number>();
  for (const n of nodes) {
    let d = 0;
    const adj = adjacency.get(n);
    if (adj !== undefined) {
      for (const m of adj.keys()) {
        if (inSet.has(m)) d++;
      }
    }
    degree.set(n, d);
  }

  const seed = pickSeed(nodes, degree);
  const seedAdj = adjacency.get(seed);
  if (seedAdj === undefined) return [seed];

  const candidates: string[] = [];
  for (const m of seedAdj.keys()) {
    if (inSet.has(m)) candidates.push(m);
  }
  candidates.sort((a, b) => {
    const wa = seedAdj.get(a) ?? 0;
    const wb = seedAdj.get(b) ?? 0;
    if (wa !== wb) return wb - wa;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const cluster = [seed];
  const clusterSet = new Set<string>([seed]);
  let edgesInside = 0;

  for (const v of candidates) {
    if (cluster.length >= maxSize) break;
    const adjV = adjacency.get(v);
    if (adjV === undefined) continue;
    let connections = 0;
    for (const member of cluster) {
      if (adjV.has(member)) connections++;
    }
    const newSize = cluster.length + 1;
    const newEdges = edgesInside + connections;
    const maxEdges = (newSize * (newSize - 1)) / 2;
    const density = newEdges / maxEdges;
    if (density >= minDensity) {
      cluster.push(v);
      clusterSet.add(v);
      edgesInside = newEdges;
    }
  }

  return cluster;
}

function pickSeed(
  nodes: readonly string[],
  degree: ReadonlyMap<string, number>,
): string {
  let seed = nonNull(nodes[0]);
  let bestDegree = degree.get(seed) ?? 0;
  for (let i = 1; i < nodes.length; i++) {
    const n = nonNull(nodes[i]);
    const d = degree.get(n) ?? 0;
    if (d > bestDegree || (d === bestDegree && n < seed)) {
      seed = n;
      bestDegree = d;
    }
  }
  return seed;
}
