/**
 * Per-node fan-in / fan-out, both unweighted (edge count) and weighted
 * (sum of `EDGE_WEIGHTS[kind]`). The weighted variant is what
 * downstream scoring uses for ranking; the unweighted variant feeds
 * the report so a candidate card can show "12 incoming edges".
 *
 * Multi-edges (two different edges from `A` to `B`) are counted once
 * each — this layer never deduplicates by `(from, to)`. The graph
 * builder allows a single source to point at the same target through
 * multiple edge kinds (e.g. `extends Foo` plus a runtime `new Foo()`),
 * and the structural intent — that this source touches the target in
 * two distinct ways — is preserved by counting both.
 */

import type { Adjacency } from "./adjacency.ts";

export interface FanResult {
  readonly fanInUnweighted: number;
  readonly fanInWeighted: number;
  readonly fanOutUnweighted: number;
  readonly fanOutWeighted: number;
}

export function computeFan(
  adjacency: Adjacency,
  nodeIndex: number,
): FanResult {
  const out = adjacency.outEdges[nodeIndex] ?? [];
  const inn = adjacency.inEdges[nodeIndex] ?? [];
  let fanOutWeighted = 0;
  for (const e of out) fanOutWeighted += e.weight;
  let fanInWeighted = 0;
  for (const e of inn) fanInWeighted += e.weight;
  return {
    fanInUnweighted: inn.length,
    fanInWeighted,
    fanOutUnweighted: out.length,
    fanOutWeighted,
  };
}
