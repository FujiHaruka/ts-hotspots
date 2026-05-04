import { describe, expect, it } from "vitest";
import type { CandidateScore } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { dropLowSemanticEvidence } from "./dropLowSemanticEvidence.ts";
import type { ScoredPair } from "./jsonReport.ts";

function fragment(id: string, filePath = "src/foo.ts"): Fragment {
  return {
    id,
    filePath,
    startLine: 1,
    endLine: 10,
    kind: "window",
    text: "",
    astNodeKind: "StatementWindow",
  };
}

function pair(
  combined: number,
  callsKeys: string[],
  changedId = "a",
  baseId = "b",
  tokenOverlap = 1,
): ScoredPair {
  const score: CandidateScore = {
    changedFragmentId: changedId,
    baseFragmentId: baseId,
    combined,
    breakdown: {
      tokenOverlap,
      statementKindSimilarity: 1,
      callOverlap: 0,
      sizeCompatibility: 1,
      lengthScore: 0,
    },
  };
  return {
    score,
    changedFragment: fragment(changedId, "src/changed.ts"),
    baseFragment: fragment(baseId, "src/base.ts"),
    intersections: { tokens: [], statements: [], calls: callsKeys },
  };
}

describe("dropLowSemanticEvidence", () => {
  it("drops pairs with no shared calls or properties when combined is below the floor", () => {
    const p = pair(0.39, []);
    expect(dropLowSemanticEvidence([p])).toEqual([]);
  });

  it("keeps pairs with at least one shared call or property even when combined is low", () => {
    const p = pair(0.2, ["CALL:foo"]);
    expect(dropLowSemanticEvidence([p])).toEqual([p]);
  });

  it("keeps pairs with no semantic evidence when combined meets the floor and token is high", () => {
    // Boundary check: combined >= 0.4 AND tokenOverlap >= 0.2 keeps the pair.
    const p = pair(0.4, [], "a", "b", 0.2);
    expect(dropLowSemanticEvidence([p])).toEqual([p]);
  });

  it("drops pairs with no semantic evidence and weak token overlap even when combined meets the floor", () => {
    // FP pattern from docs/dedup/plans/tuning-tokenNgramSizes.md: combined~0.4
    // carried by statementKindSimilarity alone while token<0.2 and callOverlap=0.
    const p = pair(0.45, [], "a", "b", 0.15);
    expect(dropLowSemanticEvidence([p])).toEqual([]);
  });

  it("keeps pairs whose token signal carries the score even without semantic anchors", () => {
    // High token overlap is enough on its own — these are the legit Type-2/3
    // matches we don't want the new gate to harm.
    const p = pair(0.45, [], "a", "b", 0.5);
    expect(dropLowSemanticEvidence([p])).toEqual([p]);
  });

  it("drops a property-only pair below the floor when intersections.calls is empty", () => {
    // Sanity: a `PROP:` shared key still lives inside `intersections.calls`
    // (see evidence.ts). With at least one entry the pair must survive.
    const p = pair(0.3, ["PROP:x.y"]);
    expect(dropLowSemanticEvidence([p])).toEqual([p]);
  });

  it("preserves order of survivors", () => {
    const p1 = pair(0.5, []);
    const p2 = pair(0.2, []);
    const p3 = pair(0.1, ["CALL:bar"]);
    expect(dropLowSemanticEvidence([p1, p2, p3])).toEqual([p1, p3]);
  });
});
