/**
 * Identify components that are pure type contracts — `type` aliases or
 * `interface` declarations whose every incident edge is `kind: "type"`.
 *
 * `arch`'s contract is to hand an agent file:line coordinates to refactor.
 * A pure type interface is a contract, not a refactor target, so the
 * scoring layer drops these node ids before ranking. Crucially, the
 * graph itself stays untouched: type nodes still serve as routing points
 * for runtime components' fan-in / fan-out / PageRank / betweenness, and
 * `EDGE_WEIGHTS["type"] = 0.3` continues to apply per-edge.
 *
 * Why both conditions (export kind *and* zero runtime edges):
 *  - `exportKind` alone over-fires: a `class` whose consumers happen to
 *    use it only as a type today is still runtime-load-bearing.
 *  - `runtimeShare === 0` alone would also drop unused enums and
 *    functions, which represent a different smell (dead code) the arch
 *    pipeline is not trying to surface here.
 */

import type { Graph } from "../graph/types.ts";

const TYPE_ONLY_EXPORT_KINDS = new Set(["type", "interface"]);

export function collectTypeOnlyNodeIds(graph: Graph): ReadonlySet<string> {
  const hasRuntimeIncident = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "type") continue;
    hasRuntimeIncident.add(edge.from);
    hasRuntimeIncident.add(edge.to);
  }

  const result = new Set<string>();
  for (const node of graph.nodes) {
    if (!TYPE_ONLY_EXPORT_KINDS.has(node.exportKind)) continue;
    if (hasRuntimeIncident.has(node.id)) continue;
    result.add(node.id);
  }
  return result;
}
