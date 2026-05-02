/**
 * Reverse closure size — for each node, the number of distinct
 * ancestors that can reach it via directed edges. This is the
 * "blast radius" axis used by the `architectural_hub` and
 * `high_impact_component` smells: a node whose closure spans most
 * of the codebase will surface a wide refactor wavefront.
 *
 * Algorithm: BFS on the reverse adjacency for each node. O(V * (V+E))
 * worst case — fine for v1's repo sizes (a few hundred to a few
 * thousand exports). If real-repo profiling in M7 shows this dominate,
 * the targeted optimisation is per-SCC condensation: every node in an
 * SCC has the same closure, so we can hoist the BFS to the SCC level.
 *
 * The node itself is **excluded** from its own closure even when it
 * lies on a cycle — the count answers "who else depends on me", not
 * "who can reach me".
 */

import type { Adjacency } from "./adjacency.ts";

export function computeReverseClosure(adjacency: Adjacency): number[] {
  const n = adjacency.nodeIds.length;
  const result: number[] = Array.from({ length: n }, () => 0);
  if (n === 0) return result;

  const visited = new Uint8Array(n);
  const queue: number[] = Array.from({ length: n }, () => 0);

  for (let start = 0; start < n; start++) {
    visited.fill(0);
    visited[start] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    let count = 0;
    while (head < tail) {
      const v = queue[head++]!;
      const inn = adjacency.inEdges[v] ?? [];
      for (const e of inn) {
        const u = e.targetIndex;
        if (visited[u] === 1) continue;
        visited[u] = 1;
        queue[tail++] = u;
        count += 1;
      }
    }
    result[start] = count;
  }
  return result;
}
