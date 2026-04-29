import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { nonNull } from "../util/nonNull.ts";
import { buildCloneGroupsFromClusters } from "./buildCloneGroupsFromClusters.ts";
import type { Cluster } from "./clusterPairs.ts";
import type { ScoredPair } from "./jsonReport.ts";

function mkFragment(id: string, filePath = `${id}.ts`): Fragment {
  return {
    id,
    filePath,
    startLine: 1,
    endLine: 10,
    kind: "function",
    text: `// ${id}`,
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
      tokenOverlap: combined,
      statementKindSimilarity: combined,
      callOverlap: combined,
      sizeCompatibility: 0.5,
      lengthScore: 0.5,
      ...breakdown,
    },
  };
}

function mkPair(
  a: Fragment,
  b: Fragment,
  combined: number,
  intersections: ScoredPair["intersections"] = {
    tokens: [],
    statements: [],
    calls: [],
  },
): ScoredPair {
  return {
    score: mkScore(combined),
    changedFragment: a,
    baseFragment: b,
    intersections,
  };
}

const noThin: ReadonlyMap<string, boolean> = new Map();

describe("buildCloneGroupsFromClusters", () => {
  it("emits an anchor-less group with members in fragmentId asc", () => {
    const a = mkFragment("a");
    const b = mkFragment("b");
    const c = mkFragment("c");
    const cluster: Cluster = {
      fragments: [c, a, b],
      pairs: [mkPair(a, b, 0.8), mkPair(a, c, 0.7), mkPair(b, c, 0.6)],
    };
    const groups = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      true,
      noThin,
    );
    expect(groups).toHaveLength(1);
    const g = nonNull(groups[0]);
    expect(g.anchor).toBeUndefined();
    expect(g.members.map((m) => m.fragment.filePath)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(g.size).toBe(3);
  });

  it("aggregateScores covers every pair in the cluster", () => {
    const a = mkFragment("a");
    const b = mkFragment("b");
    const c = mkFragment("c");
    const cluster: Cluster = {
      fragments: [a, b, c],
      pairs: [mkPair(a, b, 0.4), mkPair(a, c, 0.6), mkPair(b, c, 0.8)],
    };
    const groups = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      true,
      noThin,
    );
    const agg = groups[0]?.aggregateScores;
    if (agg === undefined) throw new Error("expected aggregate");
    expect(agg.combined).toEqual({ min: 0.4, median: 0.6, max: 0.8 });
  });

  it("sharedEvidence keeps only keys present in every cluster pair", () => {
    const a = mkFragment("a");
    const b = mkFragment("b");
    const c = mkFragment("c");
    const cluster: Cluster = {
      fragments: [a, b, c],
      pairs: [
        mkPair(a, b, 0.6, {
          tokens: [],
          statements: [],
          calls: ["call:CALL:foo", "call:CALL:bar"],
        }),
        mkPair(a, c, 0.7, {
          tokens: [],
          statements: [],
          calls: ["call:CALL:foo", "call:CALL:baz"],
        }),
        mkPair(b, c, 0.65, {
          tokens: [],
          statements: [],
          calls: ["call:CALL:foo"],
        }),
      ],
    };
    const groups = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      true,
      noThin,
    );
    const shared = groups[0]?.sharedEvidence;
    if (shared === undefined) throw new Error("expected shared evidence");
    expect(shared.sharedCalls).toEqual(["CALL:foo"]);
  });

  it("recommendationHint reflects the weakest pair", () => {
    // Weakest pair has no shared calls/properties → low-semantic-evidence
    // flag must propagate to the group.
    const a = mkFragment("a");
    const b = mkFragment("b");
    const c = mkFragment("c");
    const cluster: Cluster = {
      fragments: [a, b, c],
      pairs: [
        mkPair(a, b, 0.85, {
          tokens: [],
          statements: [],
          calls: ["call:CALL:foo"],
        }),
        mkPair(a, c, 0.4, { tokens: [], statements: [], calls: [] }),
        mkPair(b, c, 0.7, {
          tokens: [],
          statements: [],
          calls: ["call:CALL:foo"],
        }),
      ],
    };
    const groups = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      true,
      noThin,
    );
    const hint = groups[0]?.recommendationHint;
    if (hint === undefined) throw new Error("expected hint");
    expect(hint.confidence).toBe("medium");
    expect(hint.riskFlags).toContain("low-semantic-evidence");
  });

  it("orders groups by combined max desc → size desc → first id asc", () => {
    const aA = mkFragment("aA");
    const bB = mkFragment("bB");
    const cC = mkFragment("cC");
    const dD = mkFragment("dD");
    const eE = mkFragment("eE");
    const fF = mkFragment("fF");
    const clusters: Cluster[] = [
      // Cluster X: max combined 0.7, size 2
      { fragments: [aA, bB], pairs: [mkPair(aA, bB, 0.7)] },
      // Cluster Y: max combined 0.9, size 2 — should come first
      { fragments: [cC, dD], pairs: [mkPair(cC, dD, 0.9)] },
      // Cluster Z: max combined 0.7, size 3 — same max as X but bigger
      {
        fragments: [eE, fF, aA],
        pairs: [mkPair(eE, fF, 0.7), mkPair(eE, aA, 0.65), mkPair(fF, aA, 0.6)],
      },
    ];
    const groups = buildCloneGroupsFromClusters(
      clusters,
      defaultConfig,
      true,
      noThin,
    );
    expect(groups.map((g) => g.size)).toEqual([2, 3, 2]);
  });

  it("is deterministic across repeated calls", () => {
    const a = mkFragment("a");
    const b = mkFragment("b");
    const c = mkFragment("c");
    const cluster: Cluster = {
      fragments: [c, a, b],
      pairs: [mkPair(a, b, 0.8), mkPair(a, c, 0.7), mkPair(b, c, 0.6)],
    };
    const a1 = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      true,
      noThin,
    );
    const a2 = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      true,
      noThin,
    );
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
  });

  it("omits code on every fragment view when includeCode=false", () => {
    const a = mkFragment("a");
    const b = mkFragment("b");
    const cluster: Cluster = {
      fragments: [a, b],
      pairs: [mkPair(a, b, 0.7)],
    };
    const groups = buildCloneGroupsFromClusters(
      [cluster],
      defaultConfig,
      false,
      noThin,
    );
    for (const m of groups[0]?.members ?? []) {
      expect(m.fragment.code).toBeUndefined();
    }
  });
});
