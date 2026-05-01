import { describe, expect, it } from "vitest";
import {
  type Component,
  type Edge,
  type Graph,
  makeComponentId,
} from "../graph/types.ts";
import { buildAdjacency } from "./adjacency.ts";
import { computeBetweenness, withBetweenness } from "./betweenness.ts";
import { computeMetrics } from "./computeMetrics.ts";

function comp(name: string): Component {
  return {
    id: makeComponentId(`${name}.ts`, name, "function"),
    filePath: `${name}.ts`,
    exportName: name,
    exportKind: "function",
    line: 1,
  };
}

function edge(from: string, to: string): Edge {
  return {
    from: makeComponentId(`${from}.ts`, from, "function"),
    to: makeComponentId(`${to}.ts`, to, "function"),
    kind: "value",
    uncertain: false,
  };
}

function build(nodes: readonly Component[], edges: readonly Edge[]): Graph {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  return { nodes: sortedNodes, edges };
}

describe("computeBetweenness — bridge nodes", () => {
  it("the only bridge in a directed path has the highest centrality", () => {
    // A → B → C: B is on every shortest path A→C. Pairs that cross
    // B: (A, C) — exactly 1. Normalisation: (3-1)*(3-2)=2, so B = 0.5.
    const graph = build(
      [comp("A"), comp("B"), comp("C")],
      [edge("A", "B"), edge("B", "C")],
    );
    const adjacency = buildAdjacency(graph);
    const values = computeBetweenness(adjacency);
    const idx = (name: string): number =>
      adjacency.indexById.get(`${name}.ts::${name}::function`) as number;
    expect(values[idx("B")]).toBeCloseTo(0.5, 6);
    expect(values[idx("A")]).toBe(0);
    expect(values[idx("C")]).toBe(0);
  });

  it("returns zeros when no node is on a shortest path", () => {
    // 4 isolated nodes — no edges, no centrality.
    const graph = build([comp("A"), comp("B"), comp("C"), comp("D")], []);
    const adjacency = buildAdjacency(graph);
    const values = computeBetweenness(adjacency);
    expect(values).toEqual([0, 0, 0, 0]);
  });

  it("returns zeros when N < 3", () => {
    const graph = build([comp("A"), comp("B")], [edge("A", "B")]);
    const adjacency = buildAdjacency(graph);
    expect(computeBetweenness(adjacency)).toEqual([0, 0]);
  });
});

describe("withBetweenness", () => {
  it("merges betweenness into an existing metrics record", () => {
    const graph = build(
      [comp("A"), comp("B"), comp("C")],
      [edge("A", "B"), edge("B", "C")],
    );
    const { metrics, adjacency } = computeMetrics(graph);
    const merged = withBetweenness(metrics, adjacency);
    expect(merged.get("B.ts::B::function")?.betweenness).toBeCloseTo(0.5, 6);
    // Other fields preserved.
    expect(merged.get("B.ts::B::function")?.fanInUnweighted).toBe(1);
    expect(merged.get("B.ts::B::function")?.fanOutUnweighted).toBe(1);
  });

  it("invokes the timing hook exactly once", () => {
    const graph = build([comp("A")], []);
    const { metrics, adjacency } = computeMetrics(graph);
    const calls: number[] = [];
    withBetweenness(metrics, adjacency, {
      onTiming: ({ wallMs }) => calls.push(wallMs),
    });
    expect(calls.length).toBe(1);
    expect(Number.isFinite(calls[0])).toBe(true);
  });
});
