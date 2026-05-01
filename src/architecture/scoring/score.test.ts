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
    // Size axis is also populated so the rebalanced
    // `high_fanout_component` weights (0.8 fan-out + 0.2 size) clear the
    // 0.85 threshold.
    const m = metrics([
      ["hub.ts::H::function", { fanOutWeighted: 10 }],
      ["a.ts::A::function", { fanOutWeighted: 0 }],
      ["b.ts::B::function", { fanOutWeighted: 0 }],
      ["c.ts::C::function", { fanOutWeighted: 0 }],
      ["d.ts::D::function", { fanOutWeighted: 0 }],
    ]);
    const candidates = score(m, {
      lineCounts: new Map([
        ["hub.ts::H::function", 100],
        ["a.ts::A::function", 1],
        ["b.ts::B::function", 1],
        ["c.ts::C::function", 1],
        ["d.ts::D::function", 1],
      ]),
    });
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
    // Hub-like: H is the only node with high fan-in, fan-out, reverse
    // closure, and size. With every percentile == 1.0, the composite
    // equals the sum of weights == 1.0.
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
    const candidates = score(m, {
      lineCounts: new Map([
        ["hub.ts::H::function", 100],
        ["a.ts::A::function", 1],
        ["b.ts::B::function", 1],
        ["c.ts::C::function", 1],
        ["d.ts::D::function", 1],
      ]),
    });
    const hub = candidates.find((c) => c.nodeId === "hub.ts::H::function");
    // architectural_hub uses fan_in (0.35) + fan_out (0.25) +
    // reverse_closure (0.25) + size (0.15) — all percentiles 1.0.
    expect(hub?.primary.smellType).toBe("architectural_hub");
    expect(hub?.primary.composite).toBeCloseTo(1, 6);
  });
});

describe("score — unstable_edge_ratio_pct axis", () => {
  it("ranks unstable_dependency_candidate by ratio percentile, not by presence", () => {
    // unstable_dependency_candidate weights:
    //   unstable_edge_ratio_pct  0.6
    //   instability_delta_pct    0.4
    // A: ratio 1.0 (3/3) and instabilityDelta 0.5 — top of both populations.
    //    composite = 0.6 * 1 + 0.4 * 1 = 1.0  → fires.
    // B: ratio 0.1 (1/10), no delta — ratio percentile is below threshold once
    //    A pegs the top, and delta contributes 0. Below the 0.85 gate.
    const m = metrics([
      [
        "src/a.ts::A::function",
        {
          unstableEdgeCount: 3,
          unstableEdgeRatio: 1,
          fanOutUnweighted: 3,
          instabilityDelta: 0.5,
        },
      ],
      [
        "src/b.ts::B::function",
        {
          unstableEdgeCount: 1,
          unstableEdgeRatio: 0.1,
          fanOutUnweighted: 10,
        },
      ],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ]);
    const candidates = score(m);
    const a = candidates.find((c) => c.nodeId === "src/a.ts::A::function");
    expect(a?.primary.smellType).toBe("unstable_dependency_candidate");
    const ratioContribution = a?.primary.contributing.find(
      (mm) => mm.axis === "unstable_edge_ratio_pct",
    );
    expect(ratioContribution?.value).toBeCloseTo(1, 6);
    expect(ratioContribution?.percentile).toBeCloseTo(1, 6);

    expect(
      candidates.find((c) => c.nodeId === "src/b.ts::B::function"),
    ).toBeUndefined();
  });

  it("does not fire when one unstable edge sits in a population of zero ratios", () => {
    // The previous binary flag would have pegged A at 0.6 just for having
    // any unstable edge. With the percentile-ranked ratio, A's ratio (0.05)
    // is the population top so its percentile is 1.0 — the prior false
    // positive shape — but there is no `instability_delta_pct` signal, so
    // composite is 0.6 * 1.0 + 0.4 * 0 = 0.6, well under the 0.85 gate.
    const m = metrics([
      [
        "src/a.ts::A::function",
        {
          unstableEdgeCount: 1,
          unstableEdgeRatio: 0.05,
          fanOutUnweighted: 20,
        },
      ],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ]);
    expect(
      score(m).find(
        (c) => c.primary.smellType === "unstable_dependency_candidate",
      ),
    ).toBeUndefined();
  });
});

describe("score — zero-guard on percentile axes", () => {
  it("a node whose every percentile-axis raw value is 0 cannot fire any smell", () => {
    // 10 nodes; one has all signals positive, the other nine are all
    // zeros. Without the zero-guard, the percentile lookup's
    // last-occurrence-rank convention assigns a 0 raw value the
    // percentile of the tied-zero block's top — close to 1.0 — and a
    // node with no signal at all would clear the threshold by inheriting
    // the inflated percentile through `0.6 * pct + 0.4 * pct`.
    const entries: ReadonlyArray<[string, Partial<NodeMetrics>]> = [
      [
        "src/a.ts::A::function",
        {
          fanInWeighted: 10,
          fanOutWeighted: 10,
          reverseClosure: 10,
          pageRank: 1,
          betweenness: 1,
          unstableEdgeRatio: 1,
          instabilityDelta: 0.5,
        },
      ],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
      ["src/f.ts::F::function", {}],
      ["src/g.ts::G::function", {}],
      ["src/h.ts::H::function", {}],
      ["src/i.ts::I::function", {}],
      ["src/j.ts::J::function", {}],
    ];
    const lineCounts = new Map(
      entries.map(([id]) => [id, id.startsWith("src/a") ? 100 : 0]),
    );
    const result = score(metrics(entries), { lineCounts });
    expect(result.map((c) => c.nodeId)).toEqual(["src/a.ts::A::function"]);
  });

  it("a 0 raw value is reported with percentile 0 in the contributing breakdown", () => {
    const entries: ReadonlyArray<[string, Partial<NodeMetrics>]> = [
      ["src/a.ts::A::function", { fanOutWeighted: 100 }],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ];
    const lineCounts = new Map([
      ["src/a.ts::A::function", 100],
      ["src/b.ts::B::function", 1],
      ["src/c.ts::C::function", 1],
      ["src/d.ts::D::function", 1],
      ["src/e.ts::E::function", 1],
    ]);
    const result = score(metrics(entries), { lineCounts });
    const a = result.find((c) => c.nodeId === "src/a.ts::A::function");
    // high_fanout_component is the primary hit; high_impact_component
    // would be a secondary hit if A had non-zero fan_in / reverse closure
    // — A has 0 on those, so they should not contribute.
    const impactHit = a?.secondary.find(
      (s) => s.smellType === "high_impact_component",
    );
    if (impactHit !== undefined) {
      const fanIn = impactHit.contributing.find((m) => m.axis === "fan_in_pct");
      expect(fanIn?.value).toBe(0);
      expect(fanIn?.percentile).toBe(0);
    }
  });
});

describe("score — flag axes", () => {
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
      lineCounts: new Map([
        ["src/a.ts::A::function", 100],
        ["src/b.ts::B::function", 1],
        ["src/c.ts::C::function", 1],
        ["src/d.ts::D::function", 1],
        ["src/e.ts::E::function", 1],
      ]),
    });
    const a = withFlag.find((c) => c.nodeId === "src/a.ts::A::function");
    // over_shared_component: fan_in 0.35 + fan_out 0.25 + suppress 0.25
    // + size 0.15 = 1.0 with all axes maxed. The suppress hit + the
    // size axis push it over the 0.85 threshold.
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

describe("score — excludedNodeIds", () => {
  it("drops excluded ids from the output without shifting survivors' percentiles", () => {
    // Two nodes both top out fan-out and size; without exclusion both
    // qualify (composite=1.0, lex-sorted output). Excluding A must
    // drop A from the result while leaving B's contributing percentile
    // at 1.0 — i.e. A still participates in the percentile distribution.
    const m = metrics([
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
    ]);
    const lineCounts = new Map([
      ["src/a.ts::A::function", 100],
      ["src/b.ts::B::function", 100],
      ["src/c.ts::C::function", 1],
      ["src/d.ts::D::function", 1],
      ["src/e.ts::E::function", 1],
      ["src/f.ts::F::function", 1],
      ["src/g.ts::G::function", 1],
      ["src/h.ts::H::function", 1],
      ["src/i.ts::I::function", 1],
      ["src/j.ts::J::function", 1],
    ]);

    const baseline = score(m, { lineCounts });
    const baselineB = baseline.find(
      (c) => c.nodeId === "src/b.ts::B::function",
    );
    expect(baselineB).toBeDefined();

    const filtered = score(m, {
      excludedNodeIds: new Set(["src/a.ts::A::function"]),
      lineCounts,
    });
    expect(filtered.map((c) => c.nodeId)).toEqual(["src/b.ts::B::function"]);

    const filteredB = filtered[0];
    const baselineFanOut = baselineB?.primary.contributing.find(
      (mm) => mm.axis === "fan_out_pct",
    );
    const filteredFanOut = filteredB?.primary.contributing.find(
      (mm) => mm.axis === "fan_out_pct",
    );
    expect(filteredFanOut?.percentile).toBe(baselineFanOut?.percentile);
    expect(filteredB?.primary.composite).toBe(baselineB?.primary.composite);
  });
});

describe("score — determinism", () => {
  it("ties sorted by node id (lex)", () => {
    // 10 nodes; 2 outliers at 100, 8 at 0 on fan_out and size. zScore
    // for outliers ≈ 2.0 (above the default 1.5 floor); zScore for
    // zeros ≈ -0.5 (below). Both outliers tie on composite = 1.0 →
    // must sort lex.
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
    const lineCounts = new Map(
      entries.map(([id]) => [
        id,
        id.startsWith("src/a") || id.startsWith("src/b") ? 100 : 1,
      ]),
    );
    const result = score(metrics(entries), { lineCounts });
    expect(result.map((c) => c.nodeId)).toEqual([
      "src/a.ts::A::function",
      "src/b.ts::B::function",
    ]);
  });
});

describe("score — size_pct axis", () => {
  it("breaks ties between equal-coupling nodes in favor of the larger one", () => {
    // Two nodes have identical fan-out and would tie on the original
    // axes alone. Giving one a larger declaration span lifts its
    // size_pct contribution and orders it first.
    const entries: readonly [string, Partial<NodeMetrics>][] = [
      ["src/big.ts::Big::function", { fanOutWeighted: 100 }],
      ["src/small.ts::Small::function", { fanOutWeighted: 100 }],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
      ["src/f.ts::F::function", {}],
      ["src/g.ts::G::function", {}],
      ["src/h.ts::H::function", {}],
      ["src/i.ts::I::function", {}],
      ["src/j.ts::J::function", {}],
    ];
    const lineCounts = new Map([
      ["src/big.ts::Big::function", 200],
      ["src/small.ts::Small::function", 50],
      ["src/c.ts::C::function", 30],
      ["src/d.ts::D::function", 30],
      ["src/e.ts::E::function", 30],
      ["src/f.ts::F::function", 30],
      ["src/g.ts::G::function", 30],
      ["src/h.ts::H::function", 30],
      ["src/i.ts::I::function", 30],
      ["src/j.ts::J::function", 30],
    ]);
    const result = score(metrics(entries), { lineCounts });
    expect(result.map((c) => c.nodeId)).toEqual([
      "src/big.ts::Big::function",
      "src/small.ts::Small::function",
    ]);
    const big = result[0]?.primary;
    const small = result[1]?.primary;
    expect(big?.composite).toBeGreaterThan(small?.composite ?? 0);
  });

  it("contributes a size_pct entry to the primary smell's metric breakdown", () => {
    const entries: readonly [string, Partial<NodeMetrics>][] = [
      ["src/a.ts::A::function", { fanInWeighted: 10, fanOutWeighted: 10, reverseClosure: 10 }],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ];
    const lineCounts = new Map([
      ["src/a.ts::A::function", 100],
      ["src/b.ts::B::function", 1],
      ["src/c.ts::C::function", 1],
      ["src/d.ts::D::function", 1],
      ["src/e.ts::E::function", 1],
    ]);
    const result = score(metrics(entries), { lineCounts });
    const hub = result.find((c) => c.nodeId === "src/a.ts::A::function");
    const sizeContribution = hub?.primary.contributing.find(
      (m) => m.axis === "size_pct",
    );
    expect(sizeContribution).toBeDefined();
    expect(sizeContribution?.percentile).toBeCloseTo(1, 6);
    expect(sizeContribution?.weight).toBeCloseTo(0.15, 6);
  });

  it("treats missing lineCounts entries as 0 and falls through gracefully", () => {
    // No lineCounts passed at all — size_pct population is uniformly 0,
    // so percentile collapses to 0 (uniform distribution rule). A node
    // that previously cleared the gate solely on coupling now misses
    // because the rebalanced weights need size_pct to contribute.
    const m = metrics([
      ["src/a.ts::A::function", { fanOutWeighted: 100 }],
      ["src/b.ts::B::function", {}],
      ["src/c.ts::C::function", {}],
      ["src/d.ts::D::function", {}],
      ["src/e.ts::E::function", {}],
    ]);
    expect(score(m)).toEqual([]);
  });
});
