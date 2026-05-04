/**
 * Robert C. Martin's instability metric and its derived "unstable
 * dependency" signals.
 *
 * Definitions (unweighted edge counts; matches the SDP literature):
 *
 *     I(v)  = fanOut(v) / (fanIn(v) + fanOut(v))     when sum > 0
 *           = 0                                       otherwise
 *
 * An outgoing edge `u → v` is *unstable* (violates SDP) when
 * `I(v) > I(u)`: the source `u` is more stable than its dependency
 * `v`. The two derived axes pin down "how often" and "by how much":
 *
 *     unstableEdgeCount(u) = |{ v : u → v ∧ I(v) > I(u) }|
 *     unstableEdgeRatio(u) = unstableEdgeCount(u) / fanOut(u)
 *     instabilityDelta(u)  = max(0, max over u→v of (I(v) - I(u)))
 *
 * Strict inequality on `>` so an isolated cluster of `I = 0.5` nodes
 * does not flag itself. `instabilityDelta` is `0` when no outgoing
 * edge is unstable, which is the natural floor for the percentile
 * input it feeds.
 */

import type { Adjacency } from "./adjacency.ts";

interface InstabilityResult {
  readonly instability: readonly number[];
  readonly unstableEdgeCount: readonly number[];
  readonly unstableEdgeRatio: readonly number[];
  readonly instabilityDelta: readonly number[];
}

export function computeInstability(adjacency: Adjacency): InstabilityResult {
  const n = adjacency.nodeIds.length;
  const instability = Array.from({ length: n }, (): number => 0);
  const unstableEdgeCount = Array.from({ length: n }, (): number => 0);
  const unstableEdgeRatio = Array.from({ length: n }, (): number => 0);
  const instabilityDelta = Array.from({ length: n }, (): number => 0);

  for (let i = 0; i < n; i++) {
    const fanOut = (adjacency.outEdges[i] ?? []).length;
    const fanIn = (adjacency.inEdges[i] ?? []).length;
    const total = fanIn + fanOut;
    instability[i] = total === 0 ? 0 : fanOut / total;
  }

  for (let i = 0; i < n; i++) {
    const out = adjacency.outEdges[i] ?? [];
    const ii = instability[i] ?? 0;
    let unstableCount = 0;
    let maxDelta = 0;
    for (const e of out) {
      const target = instability[e.targetIndex] ?? 0;
      if (target > ii) {
        unstableCount += 1;
        const delta = target - ii;
        if (delta > maxDelta) maxDelta = delta;
      }
    }
    unstableEdgeCount[i] = unstableCount;
    unstableEdgeRatio[i] = out.length === 0 ? 0 : unstableCount / out.length;
    instabilityDelta[i] = maxDelta;
  }

  return {
    instability,
    unstableEdgeCount,
    unstableEdgeRatio,
    instabilityDelta,
  };
}
