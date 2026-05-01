import { describe, expect, it } from "vitest";
import {
  type Component,
  type Edge,
  type Graph,
  makeComponentId,
} from "../graph/types.ts";
import { computeMetrics } from "./computeMetrics.ts";

function comp(file: string, name: string): Component {
  return {
    id: makeComponentId(file, name, "function"),
    filePath: file,
    exportName: name,
    exportKind: "function",
    line: 1,
    endLine: 1,
  };
}

function edge(
  fromFile: string,
  fromName: string,
  toFile: string,
  toName: string,
  kind: Edge["kind"] = "value",
): Edge {
  return {
    from: makeComponentId(fromFile, fromName, "function"),
    to: makeComponentId(toFile, toName, "function"),
    kind,
    uncertain: false,
  };
}

function build(
  nodes: readonly Component[],
  edges: readonly Edge[],
): Graph {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  return { nodes: sortedNodes, edges };
}

describe("computeMetrics — fan-in / fan-out", () => {
  it("counts unweighted edges in both directions", () => {
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B"), comp("c.ts", "C")],
      [
        edge("a.ts", "A", "b.ts", "B"),
        edge("a.ts", "A", "c.ts", "C"),
        edge("c.ts", "C", "b.ts", "B"),
      ],
    );
    const { metrics } = computeMetrics(graph);
    const a = metrics.get("a.ts::A::function");
    const b = metrics.get("b.ts::B::function");
    const c = metrics.get("c.ts::C::function");
    expect(a?.fanOutUnweighted).toBe(2);
    expect(a?.fanInUnweighted).toBe(0);
    expect(b?.fanInUnweighted).toBe(2);
    expect(b?.fanOutUnweighted).toBe(0);
    expect(c?.fanOutUnweighted).toBe(1);
    expect(c?.fanInUnweighted).toBe(1);
  });

  it("sums EDGE_WEIGHTS for the weighted variants", () => {
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B")],
      [
        edge("a.ts", "A", "b.ts", "B", "extends"), // 2.0
        edge("a.ts", "A", "b.ts", "B", "implements"), // 1.5
      ],
    );
    const { metrics } = computeMetrics(graph);
    const a = metrics.get("a.ts::A::function");
    const b = metrics.get("b.ts::B::function");
    expect(a?.fanOutUnweighted).toBe(2);
    expect(a?.fanOutWeighted).toBeCloseTo(3.5, 6);
    expect(b?.fanInWeighted).toBeCloseTo(3.5, 6);
  });

  it("drops type-only edges when includeTypes is false", () => {
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B")],
      [edge("a.ts", "A", "b.ts", "B", "type")],
    );
    const dropped = computeMetrics(graph, { includeTypes: false }).metrics;
    expect(dropped.get("a.ts::A::function")?.fanOutUnweighted).toBe(0);
    const kept = computeMetrics(graph, { includeTypes: true }).metrics;
    expect(kept.get("a.ts::A::function")?.fanOutUnweighted).toBe(1);
    expect(kept.get("a.ts::A::function")?.fanOutWeighted).toBeCloseTo(0.3, 6);
  });
});

describe("computeMetrics — reverse closure", () => {
  it("counts every ancestor exactly once", () => {
    // Linear chain A → B → C → D. Closure of D = {A, B, C} = 3.
    const graph = build(
      [
        comp("a.ts", "A"),
        comp("b.ts", "B"),
        comp("c.ts", "C"),
        comp("d.ts", "D"),
      ],
      [
        edge("a.ts", "A", "b.ts", "B"),
        edge("b.ts", "B", "c.ts", "C"),
        edge("c.ts", "C", "d.ts", "D"),
      ],
    );
    const { metrics } = computeMetrics(graph);
    expect(metrics.get("d.ts::D::function")?.reverseClosure).toBe(3);
    expect(metrics.get("c.ts::C::function")?.reverseClosure).toBe(2);
    expect(metrics.get("a.ts::A::function")?.reverseClosure).toBe(0);
  });

  it("excludes the node itself even on a cycle", () => {
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B")],
      [edge("a.ts", "A", "b.ts", "B"), edge("b.ts", "B", "a.ts", "A")],
    );
    const { metrics } = computeMetrics(graph);
    expect(metrics.get("a.ts::A::function")?.reverseClosure).toBe(1);
    expect(metrics.get("b.ts::B::function")?.reverseClosure).toBe(1);
  });
});

describe("computeMetrics — instability", () => {
  it("computes I = Ce / (Ca + Ce)", () => {
    // A → B, C → B. B has Ca=2, Ce=0 → I=0. A: Ca=0, Ce=1 → I=1.
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B"), comp("c.ts", "C")],
      [edge("a.ts", "A", "b.ts", "B"), edge("c.ts", "C", "b.ts", "B")],
    );
    const { metrics } = computeMetrics(graph);
    expect(metrics.get("a.ts::A::function")?.instability).toBeCloseTo(1, 6);
    expect(metrics.get("b.ts::B::function")?.instability).toBeCloseTo(0, 6);
    expect(metrics.get("c.ts::C::function")?.instability).toBeCloseTo(1, 6);
  });

  it("isolated node reports I = 0", () => {
    const graph = build([comp("a.ts", "A")], []);
    const { metrics } = computeMetrics(graph);
    expect(metrics.get("a.ts::A::function")?.instability).toBe(0);
  });

  it("flags edges that violate SDP (target.I > source.I)", () => {
    // A is stable (high Ca, low Ce); B is unstable (low Ca, high Ce).
    // Edges: X→A, Y→A, A→B, B→C, B→D.
    //   I(A) = 1 / (2 + 1) = 0.333…
    //   I(B) = 2 / (1 + 2) = 0.666…
    // A→B has target.I > source.I → unstable, delta = 1/3.
    const graph = build(
      [
        comp("x.ts", "X"),
        comp("y.ts", "Y"),
        comp("a.ts", "A"),
        comp("b.ts", "B"),
        comp("c.ts", "C"),
        comp("d.ts", "D"),
      ],
      [
        edge("x.ts", "X", "a.ts", "A"),
        edge("y.ts", "Y", "a.ts", "A"),
        edge("a.ts", "A", "b.ts", "B"),
        edge("b.ts", "B", "c.ts", "C"),
        edge("b.ts", "B", "d.ts", "D"),
      ],
    );
    const { metrics } = computeMetrics(graph);
    const a = metrics.get("a.ts::A::function");
    expect(a?.unstableEdgeCount).toBe(1);
    expect(a?.unstableEdgeRatio).toBeCloseTo(1, 6);
    expect(a?.instabilityDelta).toBeCloseTo(1 / 3, 6);
  });

  it("instabilityDelta is 0 when no outgoing edge violates SDP", () => {
    // A→B with A more unstable than B (B has fan-in from another).
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B"), comp("c.ts", "C")],
      [edge("a.ts", "A", "b.ts", "B"), edge("c.ts", "C", "b.ts", "B")],
    );
    const { metrics } = computeMetrics(graph);
    expect(metrics.get("a.ts::A::function")?.instabilityDelta).toBe(0);
  });
});

describe("computeMetrics — PageRank", () => {
  it("vector sums to ~1 across all nodes", () => {
    const graph = build(
      [comp("a.ts", "A"), comp("b.ts", "B"), comp("c.ts", "C")],
      [
        edge("a.ts", "A", "b.ts", "B"),
        edge("b.ts", "B", "c.ts", "C"),
        edge("c.ts", "C", "a.ts", "A"),
      ],
    );
    const { metrics } = computeMetrics(graph);
    let sum = 0;
    for (const m of metrics.values()) sum += m.pageRank;
    expect(sum).toBeCloseTo(1, 4);
  });

  it("hub node has higher PageRank than its leaves", () => {
    // Star: A,B,C → H. H gets more rank than the leaves.
    const graph = build(
      [
        comp("a.ts", "A"),
        comp("b.ts", "B"),
        comp("c.ts", "C"),
        comp("h.ts", "H"),
      ],
      [
        edge("a.ts", "A", "h.ts", "H"),
        edge("b.ts", "B", "h.ts", "H"),
        edge("c.ts", "C", "h.ts", "H"),
      ],
    );
    const { metrics } = computeMetrics(graph);
    const h = metrics.get("h.ts::H::function")?.pageRank ?? 0;
    const a = metrics.get("a.ts::A::function")?.pageRank ?? 0;
    expect(h).toBeGreaterThan(a);
  });
});

describe("computeMetrics — determinism", () => {
  it("returns metrics keyed in lex-sorted node order", () => {
    const graph = build(
      [comp("z.ts", "Z"), comp("a.ts", "A"), comp("m.ts", "M")],
      [],
    );
    const { metrics } = computeMetrics(graph);
    expect([...metrics.keys()]).toEqual([
      "a.ts::A::function",
      "m.ts::M::function",
      "z.ts::Z::function",
    ]);
  });

  it("betweenness is 0 in M2 (filled by M3)", () => {
    const graph = build([comp("a.ts", "A")], []);
    const { metrics } = computeMetrics(graph);
    expect(metrics.get("a.ts::A::function")?.betweenness).toBe(0);
  });
});
