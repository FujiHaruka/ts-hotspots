/**
 * Weighted directed PageRank.
 *
 * Standard random-surfer formulation:
 *
 *     PR(v) = (1 - d) / N
 *           + d * ( Σ over u→v of  PR(u) * w(u, v) / W_out(u)
 *                  + dangling(u) * PR(u) / N )
 *
 * `d` is the damping factor (0.85, the canonical PageRank default).
 * `w(u, v)` is the sum of edge weights from `u` to `v`. `W_out(u)` is
 * the total outgoing weight from `u`. Nodes with `W_out(u) == 0` are
 * "dangling" — their mass is redistributed uniformly across all
 * nodes so the iteration stays a probability distribution.
 *
 * Convergence: power iteration to L1 difference ≤ 1e-9 or 200 iters,
 * whichever first. Determinism: every operation is over fixed-order
 * arrays of doubles; the same graph yields the same vector.
 */

import type { Adjacency } from "./adjacency.ts";

const DAMPING = 0.85;
const MAX_ITERS = 200;
const TOLERANCE = 1e-9;

export function computePageRank(adjacency: Adjacency): number[] {
  const n = adjacency.nodeIds.length;
  if (n === 0) return [];
  const initial = 1 / n;
  let rank: number[] = Array.from({ length: n }, () => initial);
  const totalOutWeight = Array.from({ length: n }, (): number => 0);
  for (let i = 0; i < n; i++) {
    const out = adjacency.outEdges[i] ?? [];
    let total = 0;
    for (const e of out) total += e.weight;
    totalOutWeight[i] = total;
  }

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const next: number[] = Array.from({ length: n }, () => (1 - DAMPING) / n);

    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      if ((totalOutWeight[i] ?? 0) === 0) {
        danglingSum += rank[i] ?? 0;
      }
    }
    const danglingShare = (DAMPING * danglingSum) / n;
    for (let i = 0; i < n; i++) {
      next[i] = (next[i] ?? 0) + danglingShare;
    }

    for (let u = 0; u < n; u++) {
      const out = adjacency.outEdges[u] ?? [];
      const totalW = totalOutWeight[u] ?? 0;
      if (totalW === 0) continue;
      const ru = rank[u] ?? 0;
      for (const e of out) {
        const share = (DAMPING * ru * e.weight) / totalW;
        const cur = next[e.targetIndex] ?? 0;
        next[e.targetIndex] = cur + share;
      }
    }

    let diff = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs((next[i] ?? 0) - (rank[i] ?? 0));
    }
    rank = next;
    if (diff < TOLERANCE) break;
  }

  return rank;
}
