import { describe, expect, it } from "vitest";
import type { CandidateScore } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { dropThinWrapperPairs } from "./dropThinWrapperPairs.ts";
import type { ScoredPair, ThinWrapperVerdicts } from "./jsonReport.ts";

function fragment(id: string, filePath: string): Fragment {
  return {
    id,
    filePath,
    startLine: 1,
    endLine: 10,
    kind: "function",
    text: "",
    astNodeKind: "FunctionDeclaration",
  };
}

function pair(changedId: string, baseId: string): ScoredPair {
  const score: CandidateScore = {
    changedFragmentId: changedId,
    baseFragmentId: baseId,
    combined: 0.9,
    breakdown: {
      tokenOverlap: 1,
      statementKindSimilarity: 1,
      callOverlap: 1,
      sizeCompatibility: 1,
      lengthScore: 1,
    },
  };
  return {
    score,
    changedFragment: fragment(changedId, `${changedId}.tsx`),
    baseFragment: fragment(baseId, `${baseId}.tsx`),
    intersections: { tokens: [], statements: [], calls: [] },
  };
}

function bothSides(map: ReadonlyMap<string, boolean>): ThinWrapperVerdicts {
  return { changed: map, base: map };
}

describe("dropThinWrapperPairs", () => {
  it("looks up each side in its own verdict map", () => {
    const p = pair("same", "same");
    const thin = new Map<string, boolean>([["same", true]]);
    const notThin = new Map<string, boolean>([["same", false]]);
    expect(dropThinWrapperPairs([p], { changed: thin, base: notThin })).toEqual([p]);
    expect(dropThinWrapperPairs([p], { changed: thin, base: thin })).toEqual([]);
  });

  it("drops pairs where both sides are thin wrappers", () => {
    const p = pair("c", "b");
    const map = new Map<string, boolean>([
      ["c", true],
      ["b", true],
    ]);
    expect(dropThinWrapperPairs([p], bothSides(map))).toEqual([]);
  });

  it("keeps pairs where only one side is a thin wrapper", () => {
    const p1 = pair("c1", "b1");
    const p2 = pair("c2", "b2");
    const map = new Map<string, boolean>([
      ["c1", true],
      ["b1", false],
      ["c2", false],
      ["b2", true],
    ]);
    expect(dropThinWrapperPairs([p1, p2], bothSides(map))).toEqual([p1, p2]);
  });

  it("keeps pairs where neither side is a thin wrapper", () => {
    const p = pair("c", "b");
    const map = new Map<string, boolean>([
      ["c", false],
      ["b", false],
    ]);
    expect(dropThinWrapperPairs([p], bothSides(map))).toEqual([p]);
  });

  it("returns an empty list for empty input", () => {
    expect(dropThinWrapperPairs([], bothSides(new Map()))).toEqual([]);
  });

  it("treats fragments missing from the map as not thin (preserves the pair)", () => {
    // This is the conservative fallback the pipeline relies on when it
    // cannot reach the SourceFile for a fragment.
    const p = pair("c", "b");
    expect(dropThinWrapperPairs([p], bothSides(new Map()))).toEqual([p]);
  });

  it("uses the precomputed map (no per-pair re-evaluation)", () => {
    // Same fragment id appearing in multiple pairs should be looked up
    // from the map rather than re-judged. We assert this indirectly by
    // wrapping the map's `get` to count accesses.
    const p1 = pair("c", "b1");
    const p2 = pair("c", "b2");
    const inner = new Map<string, boolean>([
      ["c", true],
      ["b1", true],
      ["b2", false],
    ]);
    let lookups = 0;
    const counting: ReadonlyMap<string, boolean> = {
      get(key) {
        lookups += 1;
        return inner.get(key);
      },
      has: (k) => inner.has(k),
      get size() {
        return inner.size;
      },
      keys: () => inner.keys(),
      values: () => inner.values(),
      entries: () => inner.entries(),
      forEach: (cb) => {
        inner.forEach(cb);
      },
      [Symbol.iterator]: () => inner[Symbol.iterator](),
    };
    const out = dropThinWrapperPairs([p1, p2], bothSides(counting));
    expect(out).toEqual([p2]);
    // 2 pairs × 2 lookups each.
    expect(lookups).toBe(4);
  });

  it("preserves order of survivors", () => {
    const p1 = pair("c1", "b1");
    const p2 = pair("c2", "b2");
    const p3 = pair("c3", "b3");
    const map = new Map<string, boolean>([
      ["c1", false],
      ["b1", false],
      ["c2", true],
      ["b2", true],
      ["c3", false],
      ["b3", false],
    ]);
    expect(dropThinWrapperPairs([p1, p2, p3], bothSides(map))).toEqual([p1, p3]);
  });
});
