import { describe, expect, test } from "vitest";
import type { PairMetrics } from "../metrics/computeMetrics.ts";
import { sortCandidates } from "./sort.ts";
import type { Candidate } from "./types.ts";

function makeCandidate(
  pathA: string,
  pathB: string,
  support: number,
  confidenceMax: number,
  lift: number,
): Candidate {
  const metrics: PairMetrics = {
    support,
    confidenceAtoB: confidenceMax,
    confidenceBtoA: confidenceMax,
    confidenceMax,
    lift,
  };
  return {
    pairKey: `${pathA} ${pathB}`,
    pathA,
    pathB,
    metrics,
    recent: [],
  };
}

describe("sortCandidates", () => {
  test("orders by support * confidenceMax desc", () => {
    // primaries: 5*0.6=3, 10*0.4=4, 3*0.9=2.7
    const input = [
      makeCandidate("src/a.ts", "src/b.ts", 5, 0.6, 2),
      makeCandidate("src/c.ts", "src/d.ts", 10, 0.4, 2),
      makeCandidate("src/e.ts", "src/f.ts", 3, 0.9, 2),
    ];
    const out = sortCandidates(input);
    expect(out.map((c) => c.pairKey)).toEqual([
      "src/c.ts src/d.ts",
      "src/a.ts src/b.ts",
      "src/e.ts src/f.ts",
    ]);
  });

  test("ties on primary are broken by lift desc", () => {
    // both primaries = 4
    const input = [
      makeCandidate("src/a.ts", "src/b.ts", 8, 0.5, 2.0),
      makeCandidate("src/c.ts", "src/d.ts", 4, 1.0, 5.0),
    ];
    const out = sortCandidates(input);
    expect(out.map((c) => c.pairKey)).toEqual([
      "src/c.ts src/d.ts",
      "src/a.ts src/b.ts",
    ]);
  });

  test("ties on primary AND lift broken by lex (pathA, pathB) asc", () => {
    const input = [
      makeCandidate("src/z.ts", "src/zz.ts", 5, 0.4, 2.0),
      makeCandidate("src/a.ts", "src/b.ts", 5, 0.4, 2.0),
      makeCandidate("src/a.ts", "src/c.ts", 5, 0.4, 2.0),
    ];
    const out = sortCandidates(input);
    expect(out.map((c) => c.pairKey)).toEqual([
      "src/a.ts src/b.ts",
      "src/a.ts src/c.ts",
      "src/z.ts src/zz.ts",
    ]);
  });

  test("truncates to limit", () => {
    const input = [
      makeCandidate("src/a.ts", "src/b.ts", 1, 0.9, 2),
      makeCandidate("src/c.ts", "src/d.ts", 5, 0.9, 2),
      makeCandidate("src/e.ts", "src/f.ts", 3, 0.9, 2),
      makeCandidate("src/g.ts", "src/h.ts", 10, 0.9, 2),
    ];
    const out = sortCandidates(input, { limit: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.pairKey)).toEqual([
      "src/g.ts src/h.ts",
      "src/c.ts src/d.ts",
    ]);
  });

  test("limit = 0 yields empty array", () => {
    const input = [makeCandidate("src/a.ts", "src/b.ts", 5, 0.5, 2)];
    expect(sortCandidates(input, { limit: 0 })).toEqual([]);
  });

  test("limit = Number.POSITIVE_INFINITY returns the full sorted list", () => {
    const input = [
      makeCandidate("src/a.ts", "src/b.ts", 1, 0.9, 2),
      makeCandidate("src/c.ts", "src/d.ts", 5, 0.9, 2),
    ];
    const out = sortCandidates(input, { limit: Number.POSITIVE_INFINITY });
    expect(out).toHaveLength(2);
    expect(out[0]?.pairKey).toBe("src/c.ts src/d.ts");
  });

  test("default options (no limit) returns the full sorted list", () => {
    const input = [
      makeCandidate("src/a.ts", "src/b.ts", 1, 0.9, 2),
      makeCandidate("src/c.ts", "src/d.ts", 5, 0.9, 2),
      makeCandidate("src/e.ts", "src/f.ts", 3, 0.9, 2),
    ];
    expect(sortCandidates(input)).toHaveLength(3);
  });

  test("deterministic on input permutation", () => {
    const a = makeCandidate("src/a.ts", "src/b.ts", 5, 0.6, 2);
    const b = makeCandidate("src/c.ts", "src/d.ts", 10, 0.4, 2);
    const c = makeCandidate("src/e.ts", "src/f.ts", 3, 0.9, 2);
    const d = makeCandidate("src/g.ts", "src/h.ts", 5, 0.6, 5); // tie with `a` on primary, higher lift
    const expected = sortCandidates([a, b, c, d]).map((x) => x.pairKey);
    const permutations: Candidate[][] = [
      [d, c, b, a],
      [b, a, d, c],
      [c, d, a, b],
      [a, c, b, d],
    ];
    for (const perm of permutations) {
      expect(sortCandidates(perm).map((x) => x.pairKey)).toEqual(expected);
    }
  });

  test("does not mutate the input array", () => {
    const input = [
      makeCandidate("src/a.ts", "src/b.ts", 1, 0.9, 2),
      makeCandidate("src/c.ts", "src/d.ts", 5, 0.9, 2),
    ];
    const before = [...input];
    sortCandidates(input);
    expect(input).toEqual(before);
  });

  test("empty input yields empty output", () => {
    expect(sortCandidates([])).toEqual([]);
    expect(sortCandidates([], { limit: 5 })).toEqual([]);
  });
});
