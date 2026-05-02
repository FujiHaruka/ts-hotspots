import { describe, expect, test } from "vitest";
import type { PairMetrics } from "../metrics/computeMetrics.ts";
import type { PairEvidence } from "../walk/walkCochange.ts";
import { applyGate } from "./applyGate.ts";
import {
  DEFAULT_CONFIDENCE_MAX_FLOOR,
  DEFAULT_MIN_SUPPORT,
  LIFT_FLOOR,
} from "./defaults.ts";

function metric(
  support: number,
  confidenceMax: number,
  lift: number,
  confidenceAtoB = confidenceMax,
  confidenceBtoA = confidenceMax,
): PairMetrics {
  return { support, confidenceAtoB, confidenceBtoA, confidenceMax, lift };
}

function buildInputs(rows: [string, PairMetrics, string[]?][]): {
  metrics: Map<string, PairMetrics>;
  pairs: Map<string, PairEvidence>;
} {
  const metrics = new Map<string, PairMetrics>();
  const pairs = new Map<string, PairEvidence>();
  for (const [key, m, recent] of rows) {
    metrics.set(key, m);
    pairs.set(key, { support: m.support, recent: recent ?? [] });
  }
  return { metrics, pairs };
}

describe("applyGate defaults", () => {
  test("the spec defaults are exported from one place", () => {
    expect(DEFAULT_MIN_SUPPORT).toBe(3);
    expect(DEFAULT_CONFIDENCE_MAX_FLOOR).toBe(0.3);
    expect(LIFT_FLOOR).toBe(1.0);
  });
});

describe("applyGate", () => {
  test("empty input yields empty output", () => {
    const { metrics, pairs } = buildInputs([]);
    expect(applyGate(metrics, pairs)).toEqual([]);
  });

  test("passes a candidate that clears all three thresholds", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.5, 2.0), ["abc1234"]],
    ]);
    const out = applyGate(metrics, pairs);
    expect(out).toHaveLength(1);
    expect(out[0]?.pairKey).toBe("src/a.ts src/b.ts");
    expect(out[0]?.pathA).toBe("src/a.ts");
    expect(out[0]?.pathB).toBe("src/b.ts");
    expect(out[0]?.recent).toEqual(["abc1234"]);
    expect(out[0]?.metrics).toBe(metrics.get("src/a.ts src/b.ts"));
  });

  test("drops pair below minSupport (just below boundary)", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(2, 0.5, 2.0)],
    ]);
    expect(applyGate(metrics, pairs)).toEqual([]);
  });

  test("includes pair exactly at minSupport boundary", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(3, 0.5, 2.0)],
    ]);
    expect(applyGate(metrics, pairs)).toHaveLength(1);
  });

  test("drops pair with lift exactly at the floor (gate is strictly >)", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.5, 1.0)],
    ]);
    expect(applyGate(metrics, pairs)).toEqual([]);
  });

  test("includes pair just above the lift floor", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.5, 1.0001)],
    ]);
    expect(applyGate(metrics, pairs)).toHaveLength(1);
  });

  test("drops pair with confidenceMax just below the floor", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.2999, 2.0)],
    ]);
    expect(applyGate(metrics, pairs)).toEqual([]);
  });

  test("includes pair with confidenceMax exactly at the floor", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.3, 2.0)],
    ]);
    expect(applyGate(metrics, pairs)).toHaveLength(1);
  });

  test("respects custom thresholds via options", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(2, 0.4, 1.5)],
      ["src/c.ts src/d.ts", metric(10, 0.4, 1.5)],
    ]);
    const out = applyGate(metrics, pairs, {
      minSupport: 5,
      confidenceMaxFloor: 0.35,
      liftFloor: 1.4,
    });
    expect(out.map((c) => c.pairKey)).toEqual(["src/c.ts src/d.ts"]);
  });

  test("a custom liftFloor of 0 still gates strictly (lift = 0 dropped)", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.5, 0)],
    ]);
    expect(applyGate(metrics, pairs, { liftFloor: 0 })).toEqual([]);
  });

  test("all-pass: every pair survives when each clears every threshold", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(3, 0.5, 1.5)],
      ["src/c.ts src/d.ts", metric(4, 0.7, 2.0)],
      ["src/e.ts src/f.ts", metric(10, 0.9, 5.0)],
    ]);
    expect(applyGate(metrics, pairs)).toHaveLength(3);
  });

  test("all-fail: each pair fails a different gate", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(2, 0.9, 5.0)], // fails minSupport
      ["src/c.ts src/d.ts", metric(10, 0.9, 1.0)], // fails lift
      ["src/e.ts src/f.ts", metric(10, 0.1, 5.0)], // fails confidenceMax
    ]);
    expect(applyGate(metrics, pairs)).toEqual([]);
  });

  test("recent SHA list is copied, not aliased", () => {
    const recent = ["aaaaaaa", "bbbbbbb"];
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.5, 2.0), recent],
    ]);
    const out = applyGate(metrics, pairs);
    expect(out[0]?.recent).toEqual(recent);
    expect(out[0]?.recent).not.toBe(recent);
  });

  test("missing pair-evidence entry yields an empty recent array", () => {
    const metrics = new Map<string, PairMetrics>([
      ["src/a.ts src/b.ts", metric(5, 0.5, 2.0)],
    ]);
    const pairs = new Map<string, PairEvidence>();
    const out = applyGate(metrics, pairs);
    expect(out).toHaveLength(1);
    expect(out[0]?.recent).toEqual([]);
  });

  test("does not mutate inputs", () => {
    const { metrics, pairs } = buildInputs([
      ["src/a.ts src/b.ts", metric(5, 0.5, 2.0), ["aaaaaaa"]],
      ["src/c.ts src/d.ts", metric(1, 0.1, 0.5)],
    ]);
    const metricsBefore = new Map(metrics);
    const pairsBefore = new Map(
      [...pairs].map(([k, v]) => [k, { ...v, recent: [...v.recent] }]),
    );
    applyGate(metrics, pairs);
    expect([...metrics.entries()]).toEqual([...metricsBefore.entries()]);
    for (const [k, v] of pairs) {
      expect(v).toEqual(pairsBefore.get(k));
    }
  });
});
