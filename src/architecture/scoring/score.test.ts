import { describe, expect, it } from "vitest";
import type { MetricsRecord, NodeMetrics } from "../metrics/types.ts";
import { ZERO_METRICS } from "../metrics/types.ts";
import { score } from "./score.ts";

function metrics(
  entries: ReadonlyArray<[string, Partial<NodeMetrics>]>,
): MetricsRecord {
  return new Map(
    entries.map(([id, partial]) => [id, { ...ZERO_METRICS, ...partial }]),
  );
}

describe("score — small-N gate", () => {
  it("requires composite >= threshold AND a z-score >= floor when N < cutoff", () => {
    // 5 nodes; only one has high fan-out. With smallNCutoff = 100 (default),
    // we're in small-N mode. The hub node should clear both gates.
    const m = metrics([
      ["hub.ts::H::function", { fanOutWeighted: 10 }],
      ["a.ts::A::function", { fanOutWeighted: 0 }],
      ["b.ts::B::function", { fanOutWeighted: 0 }],
      ["c.ts::C::function", { fanOutWeighted: 0 }],
      ["d.ts::D::function", { fanOutWeighted: 0 }],
    ]);
    const candidates = score(m);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.nodeId).toBe("hub.ts::H::function");
    expect(candidates[0]?.primary.smellType).toBe("high_fanout_component");
  });

  it("returns empty when nothing clears the threshold", () => {
    const m = metrics([
      ["a.ts::A::function", { fanOutWeighted: 1 }],
      ["b.ts::B::function", { fanOutWeighted: 1 }],
      ["c.ts::C::function", { fanOutWeighted: 1 }],
    ]);
    expect(score(m)).toEqual([]);
  });

  it("returns empty when composite would clear threshold but z-score does not (small-N)", () => {
    // Two nodes both at 5; population stddev becomes 0, z-score is 0.
    // small-N gate should reject.
    const m = metrics([
      ["a.ts::A::function", { fanOutWeighted: 5 }],
      ["b.ts::B::function", { fanOutWeighted: 5 }],
    ]);
    expect(score(m)).toEqual([]);
  });
});

describe("score — composite", () => {
  it("composite is the weighted sum of input percentiles", () => {
    // Hub-like: A is the only node with high fan-in, fan-out, and reverse closure.
    const m = metrics([
      [
        "hub.ts::H::function",
        {
          fanInWeighted: 10,
          fanOutWeighted: 10,
          reverseClosure: 10,
        },
      ],
      ["a.ts::A::function", {}],
      ["b.ts::B::function", {}],
      ["c.ts::C::function", {}],
      ["d.ts::D::function", {}],
    ]);
    const candidates = score(m);
    const hub = candidates.find((c) => c.nodeId === "hub.ts::H::function");
    // architectural_hub uses fan_in (0.4) + fan_out (0.3) + reverse_closure (0.3).
    // All three percentiles == 1.0, so composite == 1.0.
    expect(hub?.primary.smellType).toBe("architectural_hub");
    expect(hub?.primary.composite).toBeCloseTo(1, 6);
  });
});

describe("score — flag axes", () => {
  it("unstable_edge_flag contributes raw 0/1 rather than percentile", () => {
    // unstable_dependency_candidate: unstable_edge_flag (0.6) +
    // instability_delta_pct (0.4). With unstableEdgeCount > 0 and
    // instabilityDelta=0.5 at top percentile, composite = 0.6*1 + 0.4*1 = 1.0.
    const m = metrics([
      [
        "src/a.ts::A::function",
        { unstableEdgeCount: 3, instabilityDelta: 0.5 },
      ],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ]);
    const candidates = score(m);
    const a = candidates.find((c) => c.nodeId === "src/a.ts::A::function");
    expect(a).toBeDefined();
    const hit = a?.primary;
    expect(hit?.smellType === "unstable_dependency_candidate").toBe(true);
  });

  it("suppress_flag uses the option lookup, defaults to 0", () => {
    const m = metrics([
      [
        "src/a.ts::A::function",
        { fanInWeighted: 10, fanOutWeighted: 10 },
      ],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ]);
    const withFlag = score(m, {
      suppressFlag: new Map([["src/a.ts::A::function", true]]),
    });
    const a = withFlag.find((c) => c.nodeId === "src/a.ts::A::function");
    // over_shared_component: fan_in 0.4 + fan_out 0.3 + suppress 0.3 = 1.0
    // architectural_hub: fan_in 0.4 + fan_out 0.3 + reverse_closure 0.3 = 0.7
    // (reverse_closure is 0 here, so its percentile is 0.6 not 1.0;
    // composite for hub is 0.4*1 + 0.3*1 + 0.3*0.x. Either way, the
    // suppress hit pushes over_shared_component to a higher composite.)
    const oversharedHit = a?.primary.smellType === "over_shared_component"
      ? a.primary
      : a?.secondary.find((s) => s.smellType === "over_shared_component");
    expect(oversharedHit).toBeDefined();
    expect(oversharedHit?.composite).toBeCloseTo(1, 6);
  });
});

describe("score — secondary smells", () => {
  it("keeps up to two secondary hits per node", () => {
    // Hub-like: hits architectural_hub, high_fanout_component,
    // high_impact_component, over_shared_component all at high percentile.
    const m = metrics([
      [
        "src/hub.ts::H::function",
        {
          fanInWeighted: 100,
          fanOutWeighted: 100,
          reverseClosure: 100,
          pageRank: 1,
        },
      ],
      ["src/a.ts::A::function", {}],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
    ]);
    const candidates = score(m);
    const hub = candidates.find((c) => c.nodeId === "src/hub.ts::H::function");
    expect(hub?.secondary.length).toBeLessThanOrEqual(2);
  });
});

describe("score — determinism", () => {
  it("ties sorted by node id (lex)", () => {
    // 10 nodes; 2 outliers at 100, 8 at 0. zScore for outliers ≈ 2.0
    // (above the default 1.5 floor); zScore for zeros ≈ -0.5 (below).
    // Both outliers tie on composite = 1.0 → must sort lex.
    const entries: ReadonlyArray<[string, Partial<NodeMetrics>]> = [
      ["src/a.ts::A::function", { fanOutWeighted: 100 }],
      ["src/b.ts::B::function", { fanOutWeighted: 100 }],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
      ["src/f.ts::F::function", {}],
      ["src/g.ts::G::function", {}],
      ["src/h.ts::H::function", {}],
      ["src/i.ts::I::function", {}],
      ["src/j.ts::J::function", {}],
    ];
    const result = score(metrics(entries));
    expect(result.map((c) => c.nodeId)).toEqual([
      "src/a.ts::A::function",
      "src/b.ts::B::function",
    ]);
  });
});
