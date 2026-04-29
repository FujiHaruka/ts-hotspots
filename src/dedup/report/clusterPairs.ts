import type { Fragment, FragmentKind } from "../domain/fragment.ts";
import { nonNull } from "../util/nonNull.ts";
import { extractQuasiClique } from "./internal/quasiClique.ts";
import type { ScoredPair } from "./jsonReport.ts";

/**
 * Whole-repo group construction: turn a symmetric `ScoredPair[]` into a
 * set of dense clusters. Each surviving cluster represents one logical
 * code-clone family — a set of fragments that pairwise looked similar
 * enough to glue into a group.
 *
 * Pipeline:
 * 1. **Edge prune** — drop edges with `combined < minEdgeCombined`. These
 *    pairs cleared `shouldReport` only via per-axis OR and are weak glue;
 *    excluding them prevents chain-propagation of dissimilar nodes into
 *    one cluster.
 * 2. **Connected components** — BFS over the remaining edges, walking
 *    fragments in input-order (= upstream `sortCandidates` order) so the
 *    output is bit-identical across runs.
 * 3. **Density gate** — a CC with `edges / C(n,2) >= minDensity` and size
 *    `<= maxClusterSize` is reported as one cluster. Otherwise the CC is
 *    sliced via greedy quasi-clique extraction (one cluster per pass; the
 *    remainder recurses).
 * 4. **Intra-cluster cross-granularity collapse** — drop members whose
 *    line range is fully contained by a same-file member already in the
 *    cluster, mirroring `collapsePairs` but applied across the entire
 *    cluster (not just a `(changedFile, baseFile)` bucket).
 *
 * Clusters with fewer than two surviving fragments after collapse are
 * dropped — a single-fragment "cluster" is just a node with no peer to
 * report against.
 */
export interface Cluster {
  /** Final member fragments after intra-cluster collapse. */
  fragments: Fragment[];
  /**
   * Scored pairs whose both endpoints survive in `fragments`. The list
   * preserves input order so downstream code can iterate deterministically.
   */
  pairs: ScoredPair[];
}

export interface ClusterConfig {
  enabled: boolean;
  minEdgeCombined: number;
  minDensity: number;
  maxClusterSize: number;
}

export interface ClusterStats {
  components: number;
  clusters: number;
  droppedByDensity: number;
}

export function clusterPairs(
  pairs: readonly ScoredPair[],
  config: ClusterConfig,
  stats?: ClusterStats,
): Cluster[] {
  if (pairs.length === 0) return [];

  const fragmentById = new Map<string, Fragment>();
  const orderedIds: string[] = [];
  const adjacency = new Map<string, Map<string, number>>();

  const ensureNode = (f: Fragment): void => {
    if (fragmentById.has(f.id)) return;
    fragmentById.set(f.id, f);
    orderedIds.push(f.id);
    adjacency.set(f.id, new Map());
  };

  for (const pair of pairs) {
    if (pair.score.combined < config.minEdgeCombined) continue;
    const a = pair.changedFragment;
    const b = pair.baseFragment;
    if (a.id === b.id) continue;
    ensureNode(a);
    ensureNode(b);
    const adjA = nonNull(adjacency.get(a.id));
    const adjB = nonNull(adjacency.get(b.id));
    if (!adjA.has(b.id)) adjA.set(b.id, pair.score.combined);
    if (!adjB.has(a.id)) adjB.set(a.id, pair.score.combined);
  }

  if (orderedIds.length === 0) return [];

  const components = findComponents(orderedIds, adjacency);
  if (stats !== undefined) stats.components = components.length;

  const rawClusters: string[][] = [];
  for (const component of components) {
    if (component.length < 2) continue;
    extractClustersFromComponent(
      component,
      adjacency,
      config,
      rawClusters,
      stats,
    );
  }

  const finalClusters: Cluster[] = [];
  for (const idCluster of rawClusters) {
    const fragments = idCluster
      .map((id) => fragmentById.get(id))
      .filter((f): f is Fragment => f !== undefined);
    const collapsed = collapseClusterFragments(fragments);
    if (collapsed.length < 2) {
      if (stats !== undefined) stats.clusters -= 1;
      continue;
    }
    const memberIds = new Set(collapsed.map((f) => f.id));
    const survivingPairs = selectClusterPairs(
      pairs,
      memberIds,
      config.minEdgeCombined,
    );
    if (survivingPairs.length === 0) {
      if (stats !== undefined) stats.clusters -= 1;
      continue;
    }
    finalClusters.push({ fragments: collapsed, pairs: survivingPairs });
  }

  return finalClusters;
}

function selectClusterPairs(
  pairs: readonly ScoredPair[],
  memberIds: ReadonlySet<string>,
  minEdgeCombined: number,
): ScoredPair[] {
  const out: ScoredPair[] = [];
  const seenEdges = new Set<string>();
  for (const pair of pairs) {
    const aid = pair.changedFragment.id;
    const bid = pair.baseFragment.id;
    if (aid === bid) continue;
    if (!memberIds.has(aid) || !memberIds.has(bid)) continue;
    if (pair.score.combined < minEdgeCombined) continue;
    const edgeKey = aid < bid ? `${aid}|${bid}` : `${bid}|${aid}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    out.push(pair);
  }
  return out;
}

function extractClustersFromComponent(
  component: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlyMap<string, number>>,
  config: ClusterConfig,
  out: string[][],
  stats: ClusterStats | undefined,
): void {
  let remaining = component.slice();
  let safetyGuard = remaining.length + 1;
  while (remaining.length >= 2 && safetyGuard-- > 0) {
    const subComponents = findComponents(remaining, adjacency);
    if (subComponents.length > 1) {
      for (const sub of subComponents) {
        if (sub.length < 2) continue;
        extractClustersFromComponent(sub, adjacency, config, out, stats);
      }
      return;
    }
    const density = computeDensity(remaining, adjacency);
    if (
      density >= config.minDensity &&
      remaining.length <= config.maxClusterSize
    ) {
      pushCluster(out, remaining, stats);
      return;
    }
    const cluster = extractQuasiClique({
      nodes: remaining,
      adjacency,
      minDensity: config.minDensity,
      maxSize: config.maxClusterSize,
    });
    if (cluster.length >= 2) {
      pushCluster(out, cluster, stats);
    } else if (stats !== undefined) {
      stats.droppedByDensity += 1;
    }
    if (cluster.length === remaining.length) return;
    const removed = new Set(cluster);
    remaining = remaining.filter((id) => !removed.has(id));
  }
}

function pushCluster(
  out: string[][],
  ids: readonly string[],
  stats: ClusterStats | undefined,
): void {
  out.push(ids.slice());
  if (stats !== undefined) stats.clusters += 1;
}

function findComponents(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlyMap<string, number>>,
): string[][] {
  const idSet = new Set(nodeIds);
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue: string[] = [start];
    visited.add(start);
    while (queue.length > 0) {
      const node = nonNull(queue.shift());
      component.push(node);
      const adj = adjacency.get(node);
      if (adj === undefined) continue;
      for (const neighbor of adj.keys()) {
        if (!idSet.has(neighbor)) continue;
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

function computeDensity(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlyMap<string, number>>,
): number {
  if (nodeIds.length < 2) return 0;
  const idSet = new Set(nodeIds);
  let edges = 0;
  for (const id of nodeIds) {
    const adj = adjacency.get(id);
    if (adj === undefined) continue;
    for (const neighbor of adj.keys()) {
      if (idSet.has(neighbor) && id < neighbor) edges += 1;
    }
  }
  const maxEdges = (nodeIds.length * (nodeIds.length - 1)) / 2;
  return edges / maxEdges;
}

const KIND_PRIORITY: Record<FragmentKind, number> = {
  function: 0,
  block: 1,
  window: 2,
};

function collapseClusterFragments(fragments: readonly Fragment[]): Fragment[] {
  const ordered = [...fragments].sort((a, b) => {
    const sa = a.endLine - a.startLine + 1;
    const sb = b.endLine - b.startLine + 1;
    if (sa !== sb) return sb - sa;
    const ka = KIND_PRIORITY[a.kind];
    const kb = KIND_PRIORITY[b.kind];
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const kept: Fragment[] = [];
  for (const f of ordered) {
    const subsumed = kept.some(
      (k) =>
        k.filePath === f.filePath &&
        k.startLine <= f.startLine &&
        k.endLine >= f.endLine,
    );
    if (!subsumed) kept.push(f);
  }
  return kept;
}
