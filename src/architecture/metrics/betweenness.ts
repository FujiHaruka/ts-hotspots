/**
 * Exact directed-graph betweenness centrality (Brandes 2001).
 *
 * For every pair (s, t) of distinct nodes the algorithm counts the
 * fraction of shortest s-t paths that pass through `v`, summed over
 * all (s, t). The classic O(V*E) Brandes algorithm runs a BFS from
 * every source to find shortest-path counts and predecessor lists,
 * then a reverse accumulation pass to fold partial dependencies into
 * the per-node centrality.
 *
 * Edges are treated as **unweighted** for shortest-path purposes —
 * weighted Brandes requires Dijkstra, which the v1 spec defers. The
 * `--include-types[=false]` toggle still applies (because we use the
 * shared adjacency, which already filters), but every surviving edge
 * has equal traversal cost.
 *
 * Output is normalized: each value lies in `[0, 1]` after dividing
 * by `(N-1) * (N-2)` (the maximum possible betweenness for a
 * directed graph). Graphs with `N < 3` cannot have any non-trivial
 * betweenness, so all values are `0`.
 *
 * Performance: this is the heaviest metric in the pipeline and the
 * most likely candidate for sampling in a future milestone. The
 * `--phase-timings verbose` instrumentation around this call is what
 * surfaces the cost in the perf log.
 */

import type { Adjacency } from "./adjacency.ts";

export interface ComputeBetweennessOptions {
  /**
   * Optional perf-log hook. Called once with `{ wallMs }` so the
   * pipeline can route timings through `JsonlPerfLogger` without
   * pulling that module into M2/M3.
   */
  readonly onTiming?: (info: { wallMs: number }) => void;
}

export function computeBetweenness(
  adjacency: Adjacency,
  options: ComputeBetweennessOptions = {},
): number[] {
  const start = performance.now();
  const n = adjacency.nodeIds.length;
  const centrality = new Array<number>(n).fill(0);
  if (n < 3) {
    options.onTiming?.({ wallMs: performance.now() - start });
    return centrality;
  }

  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const predecessors: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Array<number>(n).fill(0);
    sigma[s] = 1;
    const distance = new Array<number>(n).fill(-1);
    distance[s] = 0;

    const queue: number[] = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++] as number;
      stack.push(v);
      const out = adjacency.outEdges[v] ?? [];
      const dv = distance[v] as number;
      const sv = sigma[v] as number;
      for (const e of out) {
        const w = e.targetIndex;
        if (distance[w] === -1) {
          distance[w] = dv + 1;
          queue.push(w);
        }
        if (distance[w] === dv + 1) {
          sigma[w] = (sigma[w] ?? 0) + sv;
          (predecessors[w] as number[]).push(v);
        }
      }
    }

    const delta = new Array<number>(n).fill(0);
    while (stack.length > 0) {
      const w = stack.pop() as number;
      const sw = sigma[w] ?? 0;
      const dw = delta[w] ?? 0;
      for (const v of predecessors[w] as number[]) {
        const sv = sigma[v] ?? 0;
        if (sw === 0) continue;
        delta[v] = (delta[v] ?? 0) + (sv / sw) * (1 + dw);
      }
      if (w !== s) {
        centrality[w] = (centrality[w] ?? 0) + dw;
      }
    }
  }

  const norm = (n - 1) * (n - 2);
  if (norm > 0) {
    for (let i = 0; i < n; i++) {
      centrality[i] = (centrality[i] ?? 0) / norm;
    }
  }
  options.onTiming?.({ wallMs: performance.now() - start });
  return centrality;
}

/**
 * Return a metrics record with the betweenness field replaced by the
 * Brandes output. Cheaper than re-running the full M2 pass when the
 * caller already has it.
 */
import type { MetricsRecord, NodeMetrics } from "./types.ts";

export function withBetweenness(
  base: MetricsRecord,
  adjacency: Adjacency,
  options: ComputeBetweennessOptions = {},
): MetricsRecord {
  const values = computeBetweenness(adjacency, options);
  const next = new Map<string, NodeMetrics>();
  for (let i = 0; i < adjacency.nodeIds.length; i++) {
    const id = adjacency.nodeIds[i] as string;
    const prev = base.get(id);
    if (prev === undefined) continue;
    next.set(id, { ...prev, betweenness: values[i] ?? 0 });
  }
  return next;
}
