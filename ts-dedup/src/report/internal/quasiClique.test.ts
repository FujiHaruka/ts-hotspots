import { describe, expect, it } from "vitest";
import { extractQuasiClique } from "./quasiClique.ts";

function buildAdjacency(
  edges: readonly [string, string, number][],
): Map<string, Map<string, number>> {
  const adj = new Map<string, Map<string, number>>();
  const ensure = (id: string): Map<string, number> => {
    let m = adj.get(id);
    if (m === undefined) {
      m = new Map();
      adj.set(id, m);
    }
    return m;
  };
  for (const [a, b, w] of edges) {
    ensure(a).set(b, w);
    ensure(b).set(a, w);
  }
  return adj;
}

describe("extractQuasiClique", () => {
  it("returns the single node when given an isolated vertex", () => {
    const cluster = extractQuasiClique({
      nodes: ["a"],
      adjacency: new Map(),
      minDensity: 0.6,
      maxSize: 50,
    });
    expect(cluster).toEqual(["a"]);
  });

  it("returns the full clique when density requirement is 1.0", () => {
    const adj = buildAdjacency([
      ["a", "b", 0.9],
      ["a", "c", 0.9],
      ["b", "c", 0.9],
    ]);
    const cluster = extractQuasiClique({
      nodes: ["a", "b", "c"],
      adjacency: adj,
      minDensity: 1.0,
      maxSize: 50,
    });
    expect(cluster.sort()).toEqual(["a", "b", "c"]);
  });

  it("rejects a chain when minDensity > 2/3", () => {
    // Chain A-B-C: edges (A-B), (B-C). Adding C to {A,B} gives density
    // 2 / 3 ≈ 0.67. With minDensity 0.7 the third node must be rejected.
    const adj = buildAdjacency([
      ["a", "b", 0.8],
      ["b", "c", 0.8],
    ]);
    const cluster = extractQuasiClique({
      nodes: ["a", "b", "c"],
      adjacency: adj,
      minDensity: 0.7,
      maxSize: 50,
    });
    expect(cluster.length).toBe(2);
    expect(cluster).toContain("b");
  });

  it("accepts a chain {A,B,C} when minDensity <= 2/3", () => {
    const adj = buildAdjacency([
      ["a", "b", 0.8],
      ["b", "c", 0.8],
    ]);
    const cluster = extractQuasiClique({
      nodes: ["a", "b", "c"],
      adjacency: adj,
      minDensity: 0.6,
      maxSize: 50,
    });
    expect(cluster.sort()).toEqual(["a", "b", "c"]);
  });

  it("seeds the highest-degree node, then breaks ties by id asc", () => {
    // C is the only node with degree 3; it must be seed regardless of
    // input order. A,B,D each have degree 1; tie-breaks pick the
    // lex-smallest neighbor (A) first when they are equally weighted.
    const adj = buildAdjacency([
      ["a", "c", 0.9],
      ["b", "c", 0.9],
      ["c", "d", 0.9],
    ]);
    const cluster = extractQuasiClique({
      nodes: ["d", "b", "a", "c"],
      adjacency: adj,
      minDensity: 0.5,
      maxSize: 50,
    });
    expect(cluster[0]).toBe("c");
    // Density of the full star is 3 / C(4,2) = 0.5, exactly meets the
    // threshold so all four are kept.
    expect(cluster.length).toBe(4);
  });

  it("respects maxSize cap", () => {
    const adj = buildAdjacency([
      ["a", "b", 1],
      ["a", "c", 1],
      ["a", "d", 1],
      ["a", "e", 1],
      ["b", "c", 1],
      ["b", "d", 1],
      ["b", "e", 1],
      ["c", "d", 1],
      ["c", "e", 1],
      ["d", "e", 1],
    ]);
    const cluster = extractQuasiClique({
      nodes: ["a", "b", "c", "d", "e"],
      adjacency: adj,
      minDensity: 1.0,
      maxSize: 3,
    });
    expect(cluster.length).toBe(3);
  });

  it("returns identical output for identical input (deterministic)", () => {
    const adj = buildAdjacency([
      ["a", "b", 0.5],
      ["a", "c", 0.7],
      ["b", "c", 0.6],
      ["c", "d", 0.4],
    ]);
    const a = extractQuasiClique({
      nodes: ["d", "a", "c", "b"],
      adjacency: adj,
      minDensity: 0.5,
      maxSize: 50,
    });
    const b = extractQuasiClique({
      nodes: ["d", "a", "c", "b"],
      adjacency: adj,
      minDensity: 0.5,
      maxSize: 50,
    });
    expect(a).toEqual(b);
  });
});
