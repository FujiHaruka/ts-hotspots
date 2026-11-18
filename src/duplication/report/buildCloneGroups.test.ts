import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/defaults.ts";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { buildCloneGroups } from "./buildCloneGroups.ts";
import type { ScoredPair, ThinWrapperVerdicts } from "./jsonReport.ts";

function mkFragment(
  id: string,
  filePath = `${id}.ts`,
  text = `// ${id}`,
): Fragment {
  return {
    id,
    filePath,
    startLine: 1,
    endLine: 10,
    kind: "function",
    text,
    astNodeKind: "FunctionDeclaration",
  };
}

function mkScore(
  combined: number,
  breakdown: Partial<ScoreBreakdown> = {},
): CandidateScore {
  return {
    changedFragmentId: "x",
    baseFragmentId: "y",
    combined,
    breakdown: {
      tokenOverlap: 0.5,
      statementKindSimilarity: 0.5,
      callOverlap: 0.5,
      sizeCompatibility: 0.5,
      lengthScore: 0.5,
      ...breakdown,
    },
  };
}

function mkPair(
  changedId: string,
  baseId: string,
  combined: number,
  opts: {
    breakdown?: Partial<ScoreBreakdown>;
    intersections?: ScoredPair["intersections"];
  } = {},
): ScoredPair {
  return {
    score: mkScore(combined, opts.breakdown),
    changedFragment: mkFragment(changedId),
    baseFragment: mkFragment(baseId),
    intersections: opts.intersections ?? {
      tokens: [],
      statements: [],
      calls: [],
    },
  };
}

const noThin: ThinWrapperVerdicts = { changed: new Map(), base: new Map() };

describe("buildCloneGroups", () => {
  it("ranks a group below an equally similar one when the diff barely changed its anchor", () => {
    const groups = buildCloneGroups(
      [mkPair("a", "b1", 0.7), mkPair("z", "b2", 0.7)],
      defaultConfig,
      true,
      noThin,
      undefined,
      new Map([
        ["a", 0.04],
        ["z", 1],
      ]),
    );
    expect(groups.map((g) => g.anchor?.location)).toEqual([
      "z.ts:1-10",
      "a.ts:1-10",
    ]);
    expect(groups[1]?.anchorChangedLineShare).toBe(0.04);
    expect(groups[1]?.aggregateScores.combined.amplified).toBeCloseTo(0.14);
    expect(groups[0]?.aggregateScores.combined.amplified).toBeCloseTo(0.7);
  });

  it("leaves the ranking untouched without changed-line shares", () => {
    const [group] = buildCloneGroups(
      [mkPair("a", "b1", 0.7)],
      defaultConfig,
      true,
      noThin,
    );
    expect(group?.anchorChangedLineShare).toBeUndefined();
    expect(group?.aggregateScores.combined.amplified).toBeCloseTo(0.7);
  });

  it("emits one group per unique changedFragment", () => {
    const groups = buildCloneGroups(
      [mkPair("c1", "b1", 0.7), mkPair("c2", "b2", 0.6)],
      defaultConfig,
      true,
      noThin,
    );
    expect(groups).toHaveLength(2);
  });

  it("collapses 3 pairs sharing an anchor into one size-4 group", () => {
    const groups = buildCloneGroups(
      [mkPair("c", "b1", 0.7), mkPair("c", "b2", 0.6), mkPair("c", "b3", 0.5)],
      defaultConfig,
      true,
      noThin,
    );
    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (group === undefined) throw new Error("expected group");
    expect(group.size).toBe(4);
    expect(group.members).toHaveLength(3);
    expect(group.anchor?.location).toBe("c.ts:1-10");
  });

  it("orders members by combined desc then base id asc", () => {
    const groups = buildCloneGroups(
      [mkPair("c", "b1", 0.5), mkPair("c", "b2", 0.7), mkPair("c", "b3", 0.5)],
      defaultConfig,
      true,
      noThin,
    );
    const memberPaths = groups[0]?.members.map((m) => m.fragment.location);
    expect(memberPaths).toEqual(["b2.ts:1-10", "b1.ts:1-10", "b3.ts:1-10"]);
  });

  it("aggregates min/median/max across the group's pairs", () => {
    const breakdown = { tokenOverlap: 0.5 };
    const groups = buildCloneGroups(
      [
        mkPair("c", "b1", 0.4, {
          breakdown: { ...breakdown, tokenOverlap: 0.3 },
        }),
        mkPair("c", "b2", 0.6, {
          breakdown: { ...breakdown, tokenOverlap: 0.5 },
        }),
        mkPair("c", "b3", 0.8, {
          breakdown: { ...breakdown, tokenOverlap: 0.9 },
        }),
      ],
      defaultConfig,
      true,
      noThin,
    );
    const agg = groups[0]?.aggregateScores;
    if (agg === undefined) throw new Error("expected aggregate");
    expect(agg.combined).toEqual({
      min: 0.4,
      median: 0.6,
      max: 0.8,
      amplified: 0.8,
    });
    expect(agg.tokenOverlap).toEqual({ min: 0.3, median: 0.5, max: 0.9 });
  });

  it("computes median as the average of the two middle values for even N", () => {
    const groups = buildCloneGroups(
      [
        mkPair("c", "b1", 0.2),
        mkPair("c", "b2", 0.4),
        mkPair("c", "b3", 0.6),
        mkPair("c", "b4", 0.8),
      ],
      defaultConfig,
      true,
      noThin,
    );
    expect(groups[0]?.aggregateScores.combined.median).toBeCloseTo(0.5, 10);
  });

  it("sharedEvidence keeps only keys present in every pair", () => {
    const groups = buildCloneGroups(
      [
        mkPair("c", "b1", 0.5, {
          intersections: {
            tokens: [],
            statements: [],
            calls: ["call:CALL:foo", "call:CALL:bar"],
          },
        }),
        mkPair("c", "b2", 0.6, {
          intersections: {
            tokens: [],
            statements: [],
            calls: ["call:CALL:foo", "call:CALL:baz"],
          },
        }),
      ],
      defaultConfig,
      true,
      noThin,
    );
    const shared = groups[0]?.sharedEvidence;
    if (shared === undefined) throw new Error("expected shared evidence");
    expect(shared.sharedCalls).toEqual(["CALL:foo"]);
  });

  it("derives recommendationHint from the weakest member", () => {
    // Two pairs: one with a low combined score that triggers
    // `low-semantic-evidence` (no shared calls/properties), one strong
    // pair. The weakest-member rule means the group's hint should reflect
    // the low pair, including its `low-semantic-evidence` flag.
    const groups = buildCloneGroups(
      [
        mkPair("c", "b1", 0.85, {
          intersections: {
            tokens: [],
            statements: [],
            calls: ["call:CALL:foo"],
          },
        }),
        mkPair("c", "b2", 0.4, {
          intersections: { tokens: [], statements: [], calls: [] },
        }),
      ],
      defaultConfig,
      true,
      noThin,
    );
    const hint = groups[0]?.recommendationHint;
    if (hint === undefined) throw new Error("expected hint");
    expect(hint.confidence).toBe("medium");
    expect(hint.riskFlags).toContain("low-semantic-evidence");
  });

  it("orders groups by aggregateScores.combined.max desc, then size desc, then anchor id asc", () => {
    // Three groups: g1 max=0.9, g2 max=0.7 size=2, g3 max=0.7 size=3.
    // Expected: g1, g3 (larger), g2.
    const pairs: ScoredPair[] = [
      mkPair("c1", "b1", 0.9),
      mkPair("c2", "b1", 0.7),
      mkPair("c3", "b1", 0.7),
      mkPair("c3", "b2", 0.65),
      mkPair("c3", "b3", 0.6),
    ];
    const groups = buildCloneGroups(pairs, defaultConfig, true, noThin);
    const anchors = groups.map((g) => g.anchor?.location);
    expect(anchors).toEqual(["c1.ts:1-10", "c3.ts:1-10", "c2.ts:1-10"]);
  });

  it("anchor and members carry code when includeCode=true", () => {
    const groups = buildCloneGroups(
      [mkPair("c", "b", 0.6)],
      defaultConfig,
      true,
      noThin,
    );
    expect(groups[0]?.anchor?.code).toBe("// c");
    expect(groups[0]?.members[0]?.fragment.code).toBe("// b");
  });

  it("omits code on every fragment view when includeCode=false", () => {
    const groups = buildCloneGroups(
      [mkPair("c", "b", 0.6)],
      defaultConfig,
      false,
      noThin,
    );
    expect(groups[0]?.anchor?.code).toBeUndefined();
    expect(groups[0]?.members[0]?.fragment.code).toBeUndefined();
  });

  it("size is anchor + members count", () => {
    const groups = buildCloneGroups(
      [mkPair("c", "b1", 0.6), mkPair("c", "b2", 0.5)],
      defaultConfig,
      true,
      noThin,
    );
    expect(groups[0]?.size).toBe(3);
    expect(groups[0]?.members).toHaveLength(2);
  });

  it("amplified equals max when churnByFile is undefined", () => {
    const groups = buildCloneGroups(
      [mkPair("c", "b", 0.6)],
      defaultConfig,
      true,
      noThin,
    );
    const combined = groups[0]?.aggregateScores.combined;
    expect(combined?.max).toBe(0.6);
    expect(combined?.amplified).toBe(0.6);
    expect(groups[0]?.aggregateChurn).toBeUndefined();
  });

  it("amplifies the group's combined.max by churnAmplifier(groupChurnMax)", () => {
    // Anchor c.ts churn=20 (cap), member b.ts churn=0 → groupMax=20
    // amplifier = 1 + 0.5 * (20/20) = 1.5; combined.max=0.6 → amplified=0.9.
    const churn = new Map<string, number>([
      ["c.ts", 20],
      ["b.ts", 0],
    ]);
    const groups = buildCloneGroups(
      [mkPair("c", "b", 0.6)],
      defaultConfig,
      true,
      noThin,
      churn,
    );
    const combined = groups[0]?.aggregateScores.combined;
    expect(combined?.max).toBeCloseTo(0.6, 10);
    expect(combined?.amplified).toBeCloseTo(0.9, 10);
    expect(groups[0]?.aggregateChurn).toEqual({
      max: 20,
      min: 0,
      perFile: { "c.ts": 20, "b.ts": 0 },
    });
  });

  it("hot group leapfrogs a colder higher-similarity group", () => {
    // Cold group: combined=0.7, churn=0 → amplified=0.7
    // Hot  group: combined=0.6, churn=20 → amplified=0.6 * 1.5 = 0.9
    const churn = new Map<string, number>([
      ["hot.ts", 20],
      ["hotB.ts", 0],
      ["cold.ts", 0],
      ["coldB.ts", 0],
    ]);
    const groups = buildCloneGroups(
      [mkPair("cold", "coldB", 0.7), mkPair("hot", "hotB", 0.6)],
      defaultConfig,
      true,
      noThin,
      churn,
    );
    expect(groups.map((g) => g.anchor?.location)).toEqual([
      "hot.ts:1-10",
      "cold.ts:1-10",
    ]);
  });

  it("is deterministic: identical input → identical output", () => {
    const pairs = [
      mkPair("c2", "b2", 0.5, {
        intersections: {
          tokens: ["token:a"],
          statements: [],
          calls: ["call:CALL:foo"],
        },
      }),
      mkPair("c1", "b1", 0.8, {
        intersections: {
          tokens: ["token:a"],
          statements: [],
          calls: ["call:CALL:foo"],
        },
      }),
      mkPair("c1", "b2", 0.6, {
        intersections: {
          tokens: ["token:b"],
          statements: [],
          calls: ["call:CALL:bar"],
        },
      }),
    ];
    const a = buildCloneGroups(pairs, defaultConfig, true, noThin);
    const b = buildCloneGroups(pairs, defaultConfig, true, noThin);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
