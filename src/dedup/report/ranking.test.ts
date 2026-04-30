import { describe, expect, it } from "vitest";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { sortCandidates, type RankablePair } from "./ranking.ts";

function mkFragment(id: string): Fragment {
  return {
    id,
    filePath: `${id}.ts`,
    startLine: 1,
    endLine: 10,
    kind: "function",
    text: "",
    astNodeKind: "FunctionDeclaration",
  };
}

function mkScore(
  changedId: string,
  baseId: string,
  combined: number,
  breakdown: Partial<ScoreBreakdown> = {},
): CandidateScore {
  return {
    changedFragmentId: changedId,
    baseFragmentId: baseId,
    combined,
    breakdown: {
      tokenOverlap: 0,
      statementKindSimilarity: 0,
      callOverlap: 0,
      sizeCompatibility: 0,
      lengthScore: 0,
      ...breakdown,
    },
  };
}

function mkPair(
  changedId: string,
  baseId: string,
  combined: number,
  breakdown: Partial<ScoreBreakdown> = {},
): RankablePair {
  return {
    score: mkScore(changedId, baseId, combined, breakdown),
    changedFragment: mkFragment(changedId),
    baseFragment: mkFragment(baseId),
  };
}

describe("sortCandidates", () => {
  it("sorts by combined score descending", () => {
    const pairs = [
      mkPair("c1", "b1", 0.3),
      mkPair("c2", "b2", 0.9),
      mkPair("c3", "b3", 0.5),
    ];
    const sorted = sortCandidates(pairs);
    expect(sorted.map((p) => p.score.combined)).toEqual([0.9, 0.5, 0.3]);
  });

  it("breaks combined ties by max(token, statement, call) descending", () => {
    const pairs = [
      mkPair("c1", "b1", 0.5, { tokenOverlap: 0.3, callOverlap: 0.3 }),
      mkPair("c2", "b2", 0.5, {
        tokenOverlap: 0.9,
        statementKindSimilarity: 0.2,
      }),
      mkPair("c3", "b3", 0.5, {
        statementKindSimilarity: 0.6,
      }),
    ];
    const sorted = sortCandidates(pairs);
    expect(sorted.map((p) => p.score.changedFragmentId)).toEqual([
      "c2",
      "c3",
      "c1",
    ]);
  });

  it("breaks further ties by changedFragment.id ascending, then baseFragment.id ascending", () => {
    const pairs = [
      mkPair("c2", "b2", 0.5, { tokenOverlap: 0.5 }),
      mkPair("c1", "b3", 0.5, { tokenOverlap: 0.5 }),
      mkPair("c1", "b1", 0.5, { tokenOverlap: 0.5 }),
    ];
    const sorted = sortCandidates(pairs);
    expect(sorted.map((p) => `${p.changedFragment.id}|${p.baseFragment.id}`)).toEqual([
      "c1|b1",
      "c1|b3",
      "c2|b2",
    ]);
  });

  it("is deterministic: running twice produces the same order", () => {
    const pairs = [
      mkPair("c2", "b2", 0.5, { tokenOverlap: 0.9 }),
      mkPair("c1", "b1", 0.5, { tokenOverlap: 0.9 }),
      mkPair("c3", "b2", 0.7),
      mkPair("c3", "b1", 0.7),
    ];
    const a = sortCandidates(pairs).map(
      (p) => `${p.changedFragment.id}|${p.baseFragment.id}`,
    );
    const b = sortCandidates(pairs).map(
      (p) => `${p.changedFragment.id}|${p.baseFragment.id}`,
    );
    expect(a).toEqual(b);
  });

  it("does not mutate the input array", () => {
    const pairs = [
      mkPair("c1", "b1", 0.3),
      mkPair("c2", "b2", 0.9),
    ];
    const before = pairs.map((p) => p.score.combined);
    sortCandidates(pairs);
    expect(pairs.map((p) => p.score.combined)).toEqual(before);
  });
});
