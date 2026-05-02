import { describe, expect, test } from "vitest";
import type { PairMetrics } from "../metrics/computeMetrics.ts";
import { sortCandidatesByAnchor } from "./sortByAnchor.ts";
import type { Candidate } from "./types.ts";

function makeCandidate(
  pathA: string,
  pathB: string,
  anchor: string,
  support: number,
  confidenceAtoB: number,
  confidenceBtoA: number,
  lift: number,
): Candidate {
  const confidenceMax = Math.max(confidenceAtoB, confidenceBtoA);
  const metrics: PairMetrics = {
    support,
    confidenceAtoB,
    confidenceBtoA,
    confidenceMax,
    lift,
  };
  return {
    pairKey: `${pathA} ${pathB}`,
    pathA,
    pathB,
    metrics,
    recent: [],
    anchor,
  };
}

describe("sortCandidatesByAnchor", () => {
  test("orders by directional confidence(anchor -> partner) desc", () => {
    const anchor = "src/anchor.ts";
    // anchor === pathA: directional confidence = confidenceAtoB.
    const input = [
      makeCandidate(anchor, "src/b.ts", anchor, 5, 0.4, 0.9, 2),
      makeCandidate(anchor, "src/c.ts", anchor, 5, 0.8, 0.1, 2),
      makeCandidate(anchor, "src/d.ts", anchor, 5, 0.6, 0.5, 2),
    ];
    const out = sortCandidatesByAnchor(input);
    expect(out.map((c) => c.pathB)).toEqual([
      "src/c.ts",
      "src/d.ts",
      "src/b.ts",
    ]);
  });

  test("uses confidenceBtoA when anchor === pathB", () => {
    const anchor = "src/zzz.ts";
    // anchor on the B side: directional confidence = confidenceBtoA.
    const input = [
      makeCandidate("src/a.ts", anchor, anchor, 5, 0.1, 0.9, 2),
      makeCandidate("src/b.ts", anchor, anchor, 5, 0.9, 0.3, 2),
    ];
    const out = sortCandidatesByAnchor(input);
    expect(out.map((c) => c.pathA)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("ties on directional confidence broken by support desc, then lift desc, then partner asc", () => {
    const anchor = "src/anchor.ts";
    const input = [
      // same directional confidence (0.5); different supports
      makeCandidate(anchor, "src/x.ts", anchor, 3, 0.5, 0.2, 2.0),
      makeCandidate(anchor, "src/y.ts", anchor, 7, 0.5, 0.2, 2.0),
      // same conf + same support; lift differs
      makeCandidate(anchor, "src/m.ts", anchor, 7, 0.5, 0.2, 5.0),
      // same conf + same support + same lift; partner lex
      makeCandidate(anchor, "src/n.ts", anchor, 7, 0.5, 0.2, 5.0),
    ];
    const out = sortCandidatesByAnchor(input);
    expect(out.map((c) => c.pathB)).toEqual([
      "src/m.ts",
      "src/n.ts",
      "src/y.ts",
      "src/x.ts",
    ]);
  });

  test("limit truncates after sort", () => {
    const anchor = "src/anchor.ts";
    const input = [
      makeCandidate(anchor, "src/b.ts", anchor, 5, 0.9, 0.1, 2),
      makeCandidate(anchor, "src/c.ts", anchor, 5, 0.4, 0.1, 2),
      makeCandidate(anchor, "src/d.ts", anchor, 5, 0.7, 0.1, 2),
    ];
    const out = sortCandidatesByAnchor(input, { limit: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.pathB)).toEqual(["src/b.ts", "src/d.ts"]);
  });

  test("does not mutate input", () => {
    const anchor = "src/anchor.ts";
    const input = [
      makeCandidate(anchor, "src/b.ts", anchor, 5, 0.4, 0.1, 2),
      makeCandidate(anchor, "src/c.ts", anchor, 5, 0.9, 0.1, 2),
    ];
    const before = [...input];
    sortCandidatesByAnchor(input);
    expect(input).toEqual(before);
  });

  test("empty input yields empty output", () => {
    expect(sortCandidatesByAnchor([])).toEqual([]);
  });
});
