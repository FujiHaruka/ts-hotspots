import { describe, expect, test } from "vitest";
import type { WalkCochangeResult } from "../walk/walkCochange.ts";
import { computeMetrics } from "./computeMetrics.ts";

function buildResult(
  pairs: Iterable<[string, { support: number; recent: string[] }]>,
  perFileChanges: Iterable<[string, number]>,
  actualWindow: number,
): WalkCochangeResult {
  return {
    perFileChanges: new Map(perFileChanges),
    pairs: new Map(pairs),
    actualWindow,
    commitsSkippedAsLargeChange: 0,
  };
}

describe("computeMetrics", () => {
  test("computes confidences and lift for a single pair", () => {
    const result = buildResult(
      [["src/a.ts src/b.ts", { support: 4, recent: [] }]],
      [
        ["src/a.ts", 5],
        ["src/b.ts", 8],
      ],
      100,
    );
    const m = computeMetrics(result).get("src/a.ts src/b.ts");
    expect(m).toBeDefined();
    if (m === undefined) return;
    expect(m.support).toBe(4);
    expect(m.confidenceAtoB).toBeCloseTo(4 / 5, 12);
    expect(m.confidenceBtoA).toBeCloseTo(4 / 8, 12);
    expect(m.confidenceMax).toBeCloseTo(4 / 5, 12);
    expect(m.lift).toBeCloseTo((4 * 100) / (5 * 8), 12);
  });

  test("confidenceMax picks the larger directional confidence", () => {
    // changesA = 10, changesB = 4, support = 3
    // a→b = 0.30, b→a = 0.75
    const result = buildResult(
      [["src/a.ts src/b.ts", { support: 3, recent: [] }]],
      [
        ["src/a.ts", 10],
        ["src/b.ts", 4],
      ],
      50,
    );
    const m = computeMetrics(result).get("src/a.ts src/b.ts");
    expect(m).toBeDefined();
    if (m === undefined) return;
    expect(m.confidenceAtoB).toBeCloseTo(0.3, 12);
    expect(m.confidenceBtoA).toBeCloseTo(0.75, 12);
    expect(m.confidenceMax).toBeCloseTo(0.75, 12);
  });

  test("lift > 1 above chance, lift = 1 at chance, lift < 1 below chance", () => {
    // window = 100. above-chance: changesA=changesB=10, support=5 → lift=5.
    // chance: changesA=changesB=10, support=1 → lift=1. below: support=0 (skipped).
    const result = buildResult(
      [
        ["src/above.ts src/x.ts", { support: 5, recent: [] }],
        ["src/chance.ts src/y.ts", { support: 1, recent: [] }],
      ],
      [
        ["src/above.ts", 10],
        ["src/x.ts", 10],
        ["src/chance.ts", 10],
        ["src/y.ts", 10],
      ],
      100,
    );
    const m = computeMetrics(result);
    expect(m.get("src/above.ts src/x.ts")?.lift).toBeCloseTo(5, 12);
    expect(m.get("src/chance.ts src/y.ts")?.lift).toBeCloseTo(1, 12);
  });

  test("skips pairs whose denominators would be zero", () => {
    // Defensive: shouldn't happen given walker invariants, but the function
    // must not divide by zero.
    const result = buildResult(
      [["src/a.ts src/b.ts", { support: 1, recent: [] }]],
      [["src/a.ts", 1]],
      10,
    );
    const m = computeMetrics(result);
    expect(m.size).toBe(0);
  });

  test("handles support equal to both denominators (perfect coupling)", () => {
    const result = buildResult(
      [["src/a.ts src/b.ts", { support: 4, recent: [] }]],
      [
        ["src/a.ts", 4],
        ["src/b.ts", 4],
      ],
      20,
    );
    const m = computeMetrics(result).get("src/a.ts src/b.ts");
    expect(m).toBeDefined();
    if (m === undefined) return;
    expect(m.confidenceAtoB).toBe(1);
    expect(m.confidenceBtoA).toBe(1);
    expect(m.confidenceMax).toBe(1);
    expect(m.lift).toBeCloseTo((4 * 20) / (4 * 4), 12);
  });

  test("computes metrics for every input pair, preserves keys", () => {
    const result = buildResult(
      [
        ["src/a.ts src/b.ts", { support: 2, recent: [] }],
        ["src/a.ts src/c.ts", { support: 3, recent: [] }],
        ["src/b.ts src/c.ts", { support: 1, recent: [] }],
      ],
      [
        ["src/a.ts", 5],
        ["src/b.ts", 4],
        ["src/c.ts", 6],
      ],
      50,
    );
    const m = computeMetrics(result);
    expect([...m.keys()].sort()).toEqual([
      "src/a.ts src/b.ts",
      "src/a.ts src/c.ts",
      "src/b.ts src/c.ts",
    ]);
  });

  test("empty input yields empty output", () => {
    const result = buildResult([], [], 0);
    expect(computeMetrics(result).size).toBe(0);
  });

  test("does not mutate the walker result", () => {
    const pairsIn = new Map([
      ["src/a.ts src/b.ts", { support: 2, recent: ["aaaaaaa"] }],
    ]);
    const perFileIn = new Map([
      ["src/a.ts", 3],
      ["src/b.ts", 2],
    ]);
    const result: WalkCochangeResult = {
      pairs: pairsIn,
      perFileChanges: perFileIn,
      actualWindow: 10,
      commitsSkippedAsLargeChange: 0,
    };
    computeMetrics(result);
    expect(pairsIn.get("src/a.ts src/b.ts")).toEqual({
      support: 2,
      recent: ["aaaaaaa"],
    });
    expect(perFileIn.get("src/a.ts")).toBe(3);
    expect(perFileIn.get("src/b.ts")).toBe(2);
  });
});
