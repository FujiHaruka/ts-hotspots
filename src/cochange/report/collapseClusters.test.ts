/**
 * Cluster-detection unit tests. The shape we're protecting:
 * - Triangles (and denser) collapse to a single cluster row.
 * - Path-like and hub-only (star) shapes stay as individual pair rows
 *   because their density is below the floor.
 * - Cluster placement preserves the input sort order via the highest-
 *   scoring constituent pair.
 * - Aggregated metrics use median for support/lift and max for
 *   confidence; recent SHA union dedupes first-occurrence.
 * - Anchor-mode (handled by the caller's branch) is irrelevant here —
 *   this function is whole-repo only and does not look at `anchor`.
 */

import { describe, expect, test } from "vitest";
import type { PairMetrics } from "../metrics/computeMetrics.ts";
import type { Candidate } from "../ranking/types.ts";
import { collapseClusters } from "./collapseClusters.ts";

function pair(
  pathA: string,
  pathB: string,
  m: Partial<PairMetrics>,
  recent: readonly string[] = [],
): Candidate {
  const metrics: PairMetrics = {
    support: 3,
    confidenceAtoB: 0.5,
    confidenceBtoA: 0.5,
    confidenceMax: 0.5,
    lift: 2.0,
    ...m,
  };
  // Canonicalise: pathA < pathB lex order, matching the gate's contract.
  const [a, b] = pathA < pathB ? [pathA, pathB] : [pathB, pathA];
  return {
    pairKey: `${a}|${b}`,
    pathA: a,
    pathB: b,
    metrics,
    recent: [...recent],
  };
}

describe("collapseClusters", () => {
  test("empty input returns empty output", () => {
    expect(collapseClusters([])).toEqual([]);
  });

  test("triangle (3 nodes, 3 edges, density 1.0) collapses to one cluster row", () => {
    const candidates: Candidate[] = [
      pair("a.ts", "b.ts", { support: 6, confidenceMax: 0.8 }, ["sha1"]),
      pair("b.ts", "c.ts", { support: 4, confidenceMax: 0.6 }, ["sha2"]),
      pair("a.ts", "c.ts", { support: 3, confidenceMax: 1.0 }, ["sha3"]),
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row?.kind !== "cluster") throw new Error("expected cluster");
    expect(row.cluster.members).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(row.cluster.pairs).toHaveLength(3);
    // Median of [6, 4, 3] = 4
    expect(row.cluster.supportMedian).toBe(4);
    // Max of [0.8, 0.6, 1.0] = 1.0
    expect(row.cluster.confidenceMaxOverall).toBe(1.0);
    // scoreMax = max(6*0.8, 4*0.6, 3*1.0) = 4.8
    expect(row.cluster.scoreMax).toBeCloseTo(4.8);
    // recentUnion is first-occurrence dedup across pairs, in input order
    expect(row.cluster.recentUnion).toEqual(["sha1", "sha2", "sha3"]);
  });

  test("square (4 nodes, 4 edges, density 4/6 ≈ 0.67) collapses to one cluster", () => {
    // a-b, b-c, c-d, d-a — 4 edges across 4 nodes, density 0.67
    const candidates: Candidate[] = [
      pair("a.ts", "b.ts", { support: 5 }),
      pair("b.ts", "c.ts", { support: 4 }),
      pair("c.ts", "d.ts", { support: 3 }),
      pair("a.ts", "d.ts", { support: 6 }),
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row?.kind !== "cluster") throw new Error("expected cluster");
    expect(row.cluster.members).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  test("path (4 nodes, 3 edges, density 0.5) qualifies at the boundary", () => {
    // a-b, b-c, c-d — exactly the floor
    const candidates: Candidate[] = [
      pair("a.ts", "b.ts", { support: 5 }),
      pair("b.ts", "c.ts", { support: 4 }),
      pair("c.ts", "d.ts", { support: 3 }),
    ];
    const rows = collapseClusters(candidates);
    // Density === floor → qualifies (>=, not >)
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("cluster");
  });

  test("4-node star (1 hub + 3 leaves, density 3/6 = 0.5) qualifies at the boundary", () => {
    // hub-a, hub-b, hub-c — density 0.5 exactly. Documents the boundary
    // case: at the floor, even a star qualifies. Above 4 leaves the density
    // drops below floor and the star reverts to pair rows (covered below).
    const candidates: Candidate[] = [
      pair("hub.ts", "a.ts", { support: 6 }),
      pair("hub.ts", "b.ts", { support: 5 }),
      pair("hub.ts", "c.ts", { support: 4 }),
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("cluster");
  });

  test("5-node star (1 hub + 4 leaves, density 4/10 = 0.4) stays as pair rows", () => {
    // Below the 0.5 floor — central-file amplification, not a true cluster.
    const candidates: Candidate[] = [
      pair("hub.ts", "a.ts", { support: 6 }),
      pair("hub.ts", "b.ts", { support: 5 }),
      pair("hub.ts", "c.ts", { support: 4 }),
      pair("hub.ts", "d.ts", { support: 3 }),
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kind === "pair")).toBe(true);
  });

  test("disjoint pair stays a pair row", () => {
    const candidates: Candidate[] = [
      pair("a.ts", "b.ts", { support: 5 }),
      pair("c.ts", "d.ts", { support: 4 }),
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "pair")).toBe(true);
  });

  test("cluster row sits at the position of its highest-scoring pair", () => {
    // (a, b, c) form a triangle with highest pair-score 4.8.
    // (d, e) is a disjoint pair with score 5.0 — should sort BEFORE the cluster.
    // (f, g) is a disjoint pair with score 3.0 — should sort AFTER.
    const candidates: Candidate[] = [
      pair("d.ts", "e.ts", { support: 5, confidenceMax: 1.0 }), // score 5.0
      pair("a.ts", "b.ts", { support: 6, confidenceMax: 0.8 }), // score 4.8 (cluster start)
      pair("b.ts", "c.ts", { support: 4, confidenceMax: 0.6 }),
      pair("a.ts", "c.ts", { support: 3, confidenceMax: 1.0 }),
      pair("f.ts", "g.ts", { support: 3, confidenceMax: 1.0 }), // score 3.0
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.kind).toBe("pair");
    expect(rows[1]?.kind).toBe("cluster");
    expect(rows[2]?.kind).toBe("pair");
    if (rows[1]?.kind === "cluster") {
      expect(rows[1].cluster.members).toEqual(["a.ts", "b.ts", "c.ts"]);
    }
  });

  test("recentUnion dedupes shared SHAs first-occurrence, preserving input order", () => {
    // (a, b) and (b, c) share sha-shared. (a, c) is unique.
    const candidates: Candidate[] = [
      pair("a.ts", "b.ts", { support: 4 }, ["sha1", "sha-shared"]),
      pair("b.ts", "c.ts", { support: 3 }, ["sha-shared", "sha2"]),
      pair("a.ts", "c.ts", { support: 3 }, ["sha3"]),
    ];
    const rows = collapseClusters(candidates);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row?.kind !== "cluster") throw new Error("expected cluster");
    expect(row.cluster.recentUnion).toEqual([
      "sha1",
      "sha-shared",
      "sha2",
      "sha3",
    ]);
  });

  test("median for even pair count averages the two middle values", () => {
    // Square: supports [5, 4, 3, 6]. Sorted [3, 4, 5, 6]. Median = (4+5)/2 = 4.5.
    const candidates: Candidate[] = [
      pair("a.ts", "b.ts", { support: 5 }),
      pair("b.ts", "c.ts", { support: 4 }),
      pair("c.ts", "d.ts", { support: 3 }),
      pair("a.ts", "d.ts", { support: 6 }),
    ];
    const rows = collapseClusters(candidates);
    const row = rows[0];
    if (row?.kind !== "cluster") throw new Error("expected cluster");
    expect(row.cluster.supportMedian).toBe(4.5);
  });

  test("members list is lex-sorted regardless of input pair order", () => {
    const candidates: Candidate[] = [
      pair("z.ts", "y.ts", { support: 5 }),
      pair("y.ts", "x.ts", { support: 4 }),
      pair("z.ts", "x.ts", { support: 3 }),
    ];
    const rows = collapseClusters(candidates);
    const row = rows[0];
    if (row?.kind !== "cluster") throw new Error("expected cluster");
    expect(row.cluster.members).toEqual(["x.ts", "y.ts", "z.ts"]);
  });
});
