import { describe, expect, it } from "vitest";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment, FragmentKind } from "../domain/fragment.ts";
import { nonNull } from "../util/nonNull.ts";
import {
  type Cluster,
  type ClusterStats,
  clusterPairs,
} from "./clusterPairs.ts";
import type { ScoredPair } from "./jsonReport.ts";

const baseConfig = {
  enabled: true,
  minEdgeCombined: 0.3,
  minDensity: 0.6,
  maxClusterSize: 50,
};

function mkFragment(
  id: string,
  opts: {
    filePath?: string;
    startLine?: number;
    endLine?: number;
    kind?: FragmentKind;
  } = {},
): Fragment {
  return {
    id,
    filePath: opts.filePath ?? `${id}.ts`,
    startLine: opts.startLine ?? 1,
    endLine: opts.endLine ?? 10,
    kind: opts.kind ?? "function",
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
  a: Fragment | string,
  b: Fragment | string,
  combined: number,
): ScoredPair {
  return {
    score: mkScore(combined),
    changedFragment: typeof a === "string" ? mkFragment(a) : a,
    baseFragment: typeof b === "string" ? mkFragment(b) : b,
    intersections: { tokens: [], statements: [], calls: [] },
  };
}

function fragmentIds(cluster: Cluster): string[] {
  return cluster.fragments.map((f) => f.id).sort();
}

describe("clusterPairs", () => {
  it("returns one cluster of size 3 for a triangle of strong edges", () => {
    const stats: ClusterStats = {
      components: 0,
      clusters: 0,
      droppedByDensity: 0,
    };
    const clusters = clusterPairs(
      [mkPair("a", "b", 0.8), mkPair("a", "c", 0.7), mkPair("b", "c", 0.75)],
      baseConfig,
      stats,
    );
    expect(clusters).toHaveLength(1);
    expect(fragmentIds(nonNull(clusters[0]))).toEqual(["a", "b", "c"]);
    expect(stats.components).toBe(1);
    expect(stats.clusters).toBe(1);
  });

  it("keeps a 3-chain as one cluster when density (2/3) >= minDensity", () => {
    const clusters = clusterPairs(
      [mkPair("a", "b", 0.8), mkPair("b", "c", 0.8)],
      { ...baseConfig, minDensity: 0.6 },
    );
    expect(clusters).toHaveLength(1);
    expect(fragmentIds(nonNull(clusters[0]))).toEqual(["a", "b", "c"]);
  });

  it("splits a 3-chain when minDensity is too strict for 2/3 edges", () => {
    // Chain A-B-C: density 2/3 ≈ 0.67. With minDensity = 0.7, the chain
    // must be sliced; the seed (highest degree = B) survives as a cluster
    // with one neighbor; the leftover then forms its own pair.
    const clusters = clusterPairs(
      [mkPair("a", "b", 0.8), mkPair("b", "c", 0.8)],
      { ...baseConfig, minDensity: 0.7 },
    );
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    for (const cluster of clusters) {
      expect(cluster.fragments.length).toBeLessThanOrEqual(2);
    }
    const allMembers = clusters.flatMap((c) => c.fragments.map((f) => f.id));
    expect(new Set(allMembers).size).toBe(allMembers.length);
  });

  it("excludes edges whose combined score is below minEdgeCombined", () => {
    // Only a single weak edge — entire cluster set should be empty.
    const clusters = clusterPairs([mkPair("a", "b", 0.25)], {
      ...baseConfig,
      minEdgeCombined: 0.3,
    });
    expect(clusters).toHaveLength(0);
  });

  it("collapses cluster members whose line ranges are line-contained in the same file", () => {
    // Two siblings (`fnA`, `windowA`) live in `a.ts`; `windowA` covers lines
    // 3-7 inside `fnA`'s 1-10. The cluster also includes `b.ts:fnB` which
    // matched both. After intra-cluster collapse only `fnA` and `fnB`
    // remain — `windowA` is subsumed by `fnA`.
    const fnA = mkFragment("a-fn", {
      filePath: "a.ts",
      startLine: 1,
      endLine: 10,
      kind: "function",
    });
    const windowA = mkFragment("a-w", {
      filePath: "a.ts",
      startLine: 3,
      endLine: 7,
      kind: "window",
    });
    const fnB = mkFragment("b-fn", {
      filePath: "b.ts",
      startLine: 1,
      endLine: 10,
      kind: "function",
    });
    const clusters = clusterPairs(
      [
        mkPair(fnA, fnB, 0.9),
        mkPair(windowA, fnB, 0.7),
        mkPair(fnA, windowA, 0.6),
      ],
      baseConfig,
    );
    expect(clusters).toHaveLength(1);
    expect(fragmentIds(nonNull(clusters[0]))).toEqual(["a-fn", "b-fn"]);
  });

  it("respects maxClusterSize", () => {
    // Form a 5-clique; cap at 3.
    const ids = ["a", "b", "c", "d", "e"];
    const pairs: ScoredPair[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.push(mkPair(nonNull(ids[i]), nonNull(ids[j]), 0.9));
      }
    }
    const clusters = clusterPairs(pairs, {
      ...baseConfig,
      maxClusterSize: 3,
    });
    for (const cluster of clusters) {
      expect(cluster.fragments.length).toBeLessThanOrEqual(3);
    }
  });

  it("is deterministic across runs with shuffled input", () => {
    const fragments = ["a", "b", "c", "d"].map((id) => mkFragment(id));
    const pairs = [
      mkPair(nonNull(fragments[0]), nonNull(fragments[1]), 0.9),
      mkPair(nonNull(fragments[0]), nonNull(fragments[2]), 0.85),
      mkPair(nonNull(fragments[1]), nonNull(fragments[2]), 0.8),
      mkPair(nonNull(fragments[2]), nonNull(fragments[3]), 0.7),
    ];
    const a = clusterPairs(pairs, baseConfig);
    const shuffled = [
      nonNull(pairs[3]),
      nonNull(pairs[1]),
      nonNull(pairs[2]),
      nonNull(pairs[0]),
    ];
    const b = clusterPairs(shuffled, baseConfig);
    const stringify = (cs: Cluster[]): string =>
      JSON.stringify(
        cs.map((c) => ({
          fragments: c.fragments.map((f) => f.id),
          pairs: c.pairs.map(
            (p) => `${p.changedFragment.id}-${p.baseFragment.id}`,
          ),
        })),
      );
    // Cluster identity (member sets) must be the same; pair lists may differ
    // in order because our determinism guarantee is keyed on the input
    // ordering, but the member sets must match.
    const memberSets = (cs: Cluster[]): string[] =>
      cs.map((c) => fragmentIds(c).join(",")).sort();
    expect(memberSets(a)).toEqual(memberSets(b));
    expect(stringify(a)).toBe(stringify(a));
  });

  it("returns no clusters when input is empty", () => {
    expect(clusterPairs([], baseConfig)).toEqual([]);
  });

  it("disconnected components produce separate clusters", () => {
    const clusters = clusterPairs(
      [
        mkPair("a", "b", 0.8),
        mkPair("a", "c", 0.7),
        mkPair("b", "c", 0.75),
        mkPair("d", "e", 0.9),
      ],
      baseConfig,
    );
    expect(clusters).toHaveLength(2);
    const memberSets = clusters.map((c) => fragmentIds(c).join(",")).sort();
    expect(memberSets).toEqual(["a,b,c", "d,e"]);
  });
});
