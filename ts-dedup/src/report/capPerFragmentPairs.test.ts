import { describe, expect, it } from "vitest";
import type { CandidateScore } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { capPerFragmentPairs } from "./capPerFragmentPairs.ts";
import type { ScoredPair } from "./jsonReport.ts";

function fragment(id: string): Fragment {
  return {
    id,
    filePath: `src/${id}.ts`,
    startLine: 1,
    endLine: 10,
    kind: "window",
    text: "",
    astNodeKind: "StatementWindow",
  };
}

function pair(combined: number, changedId: string, baseId: string): ScoredPair {
  const score: CandidateScore = {
    changedFragmentId: changedId,
    baseFragmentId: baseId,
    combined,
    breakdown: {
      tokenOverlap: 1,
      statementKindSimilarity: 1,
      callOverlap: 0,
      sizeCompatibility: 1,
      lengthScore: 0,
    },
  };
  return {
    score,
    changedFragment: fragment(changedId),
    baseFragment: fragment(baseId),
    intersections: { tokens: [], statements: [], calls: [] },
  };
}

describe("capPerFragmentPairs", () => {
  it("keeps every pair when no fragment exceeds the cap", () => {
    const pairs = [pair(0.9, "a", "b"), pair(0.8, "c", "d")];
    expect(capPerFragmentPairs(pairs)).toEqual(pairs);
  });

  it("caps a hot fragment to its first three associates", () => {
    // `hot` will pair with five different counterparts; only the first
    // three (in input order = score order) survive.
    const pairs = [
      pair(0.9, "hot", "x1"),
      pair(0.8, "hot", "x2"),
      pair(0.7, "hot", "x3"),
      pair(0.6, "hot", "x4"),
      pair(0.5, "hot", "x5"),
    ];
    expect(capPerFragmentPairs(pairs)).toEqual(pairs.slice(0, 3));
  });

  it("blocks a pair when either side already reached the cap", () => {
    // `hot` reaches the cap on the changed side; the next pair where it
    // appears on the base side is also blocked.
    const pairs = [
      pair(0.9, "hot", "x1"),
      pair(0.8, "hot", "x2"),
      pair(0.7, "hot", "x3"),
      pair(0.6, "y", "hot"),
    ];
    expect(capPerFragmentPairs(pairs)).toEqual(pairs.slice(0, 3));
  });

  it("preserves pairs that involve only fresh fragments after the cap fires", () => {
    const pairs = [
      pair(0.9, "hot", "x1"),
      pair(0.8, "hot", "x2"),
      pair(0.7, "hot", "x3"),
      pair(0.6, "hot", "x4"), // dropped (hot exhausted)
      pair(0.5, "fresh1", "fresh2"), // kept
    ];
    const out = capPerFragmentPairs(pairs);
    expect(out).toHaveLength(4);
    expect(out[3]).toBe(pairs[4]);
  });
});
