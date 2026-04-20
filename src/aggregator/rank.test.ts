import { describe, expect, test } from "vitest";
import type { FunctionEntry } from "../schema.ts";
import {
  collectFunctionRefKeys,
  computeFunctionAxisMeta,
  computeFunctionCoOccurrence,
  computeFunctionHotspotCandidates,
  emptyFunctionRankings,
  filterFunctionRankings,
  rankFunctions,
} from "./rank.ts";

function fn(opts: {
  file: string;
  line?: number;
  endLine?: number;
  name?: string;
  cognitive?: number;
  cyclomatic?: number;
  anyCount?: number;
  tsIgnore?: number;
  tsExpectError?: number;
  tsNocheck?: number;
  callerCount?: number;
}): FunctionEntry {
  const start = opts.line ?? 1;
  const end = opts.endLine ?? start;
  const location =
    start === end
      ? `${opts.file}:${String(start)}`
      : `${opts.file}:${String(start)}-${String(end)}`;
  return {
    location,
    name: opts.name ?? "f",
    kind: "function",
    metrics: {
      cyclomaticComplexity: opts.cyclomatic ?? 0,
      cognitiveComplexity: opts.cognitive ?? 0,
      sloc: 0,
      statementCount: 0,
      parameterCount: 0,
      maxNestingDepth: 0,
      returnCount: 0,
      anyCount: opts.anyCount ?? 0,
      anyTaintedExpressionCount: 0,
      typeAssertionCount: 0,
      unsafeCastCount: 0,
      nonNullAssertionCount: 0,
      tsIgnoreCount: opts.tsIgnore ?? 0,
      tsExpectErrorCount: opts.tsExpectError ?? 0,
      tsNocheckCount: opts.tsNocheck ?? 0,
      callerCount: opts.callerCount ?? 0,
      calleeCount: 0,
      tryCatchCount: 0,
      awaitCount: 0,
      mutationSiteCount: 0,
    },
    bodyHash: `sha256:${opts.file}:${String(start)}:${opts.name ?? "f"}`,
  };
}

describe("rankFunctions", () => {
  test("sorts descending by axis value and assigns 1-indexed rank", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "low", cognitive: 1 }),
      fn({ file: "b.ts", name: "high", cognitive: 10 }),
      fn({ file: "c.ts", name: "mid", cognitive: 5 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    expect(rankings.cognitiveComplexity.map((e) => e.ref.name)).toEqual([
      "high",
      "mid",
      "low",
    ]);
    expect(rankings.cognitiveComplexity.map((e) => e.value)).toEqual([
      10, 5, 1,
    ]);
  });

  test("deterministic tiebreak: file → line → name", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "b.ts", line: 1, name: "x", cognitive: 5 }),
      fn({ file: "a.ts", line: 2, name: "y", cognitive: 5 }),
      fn({ file: "a.ts", line: 1, name: "z", cognitive: 5 }),
      fn({ file: "a.ts", line: 1, name: "a", cognitive: 5 }),
    ];
    const rankings = rankFunctions(entries, { topN: 4 });
    expect(
      rankings.cognitiveComplexity.map((e) => [e.ref.location, e.ref.name]),
    ).toEqual([
      ["a.ts:1", "a"],
      ["a.ts:1", "z"],
      ["a.ts:2", "y"],
      ["b.ts:1", "x"],
    ]);
  });

  test("topN cuts the list", () => {
    const entries: FunctionEntry[] = Array.from({ length: 10 }, (_, i) =>
      fn({ file: `f${String(i)}.ts`, cognitive: 10 - i }),
    );
    const rankings = rankFunctions(entries, { topN: 3 });
    expect(rankings.cognitiveComplexity).toHaveLength(3);
    expect(rankings.cognitiveComplexity.map((e) => e.value)).toEqual([
      10, 9, 8,
    ]);
  });

  test("filters zero-value entries within the topN slice", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "hi", cognitive: 3 }),
      fn({ file: "b.ts", name: "zero" }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    expect(rankings.cognitiveComplexity.map((e) => e.ref.name)).toEqual(["hi"]);
  });

  test("tsSuppressionsFamily sums ts-ignore/expect-error/nocheck and drops zero", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "sum6",
        tsIgnore: 2,
        tsExpectError: 3,
        tsNocheck: 1,
      }),
      fn({ file: "b.ts", name: "sum4", tsIgnore: 4 }),
      fn({ file: "c.ts", name: "sum0" }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    expect(
      rankings.tsSuppressionsFamily.map((e) => [e.ref.name, e.value]),
    ).toEqual([
      ["sum6", 6],
      ["sum4", 4],
    ]);
  });

  test("empty input returns empty arrays for all axes", () => {
    const rankings = rankFunctions([], { topN: 5 });
    expect(rankings.cognitiveComplexity).toEqual([]);
    expect(rankings.tsSuppressionsFamily).toEqual([]);
  });

  test("all-zero input returns empty array for each axis", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts" }),
      fn({ file: "b.ts" }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    expect(rankings.cognitiveComplexity).toEqual([]);
    expect(rankings.tsSuppressionsFamily).toEqual([]);
  });
});

describe("dedup collectors", () => {
  test("collectFunctionRefKeys dedups across axes", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "x", cognitive: 5, cyclomatic: 5 }),
      fn({ file: "b.ts", name: "y", cognitive: 2, anyCount: 7 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const keys = collectFunctionRefKeys(rankings);
    expect(keys.size).toBe(2);
  });
});

describe("computeFunctionCoOccurrence", () => {
  test("collects refs hit by 2+ axes, sorted by axisHitCount desc", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        cyclomatic: 9,
        anyCount: 4,
        tsIgnore: 3,
      }),
      fn({ file: "b.ts", name: "two", cognitive: 8, cyclomatic: 7 }),
      fn({ file: "c.ts", name: "solo", cognitive: 6 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const co = computeFunctionCoOccurrence(rankings);
    expect(co.map((e) => [e.ref.name, e.axisHitCount])).toEqual([
      ["hot", 4],
      ["two", 2],
    ]);
    expect(co[0]?.axes).toEqual([
      "cognitiveComplexity",
      "cyclomaticComplexity",
      "anyCount",
      "tsSuppressionsFamily",
    ]);
  });

  test("excludes refs hit by only 1 axis", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "single", cognitive: 5 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const co = computeFunctionCoOccurrence(rankings);
    expect(co).toEqual([]);
  });

  test("axes are emitted in FUNCTION_AXIS_IDS declaration order", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "x",
        anyCount: 5,
        cognitive: 5,
        tsIgnore: 5,
        cyclomatic: 5,
      }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const co = computeFunctionCoOccurrence(rankings);
    expect(co[0]?.axes).toEqual([
      "cognitiveComplexity",
      "cyclomaticComplexity",
      "anyCount",
      "tsSuppressionsFamily",
    ]);
  });

  test("ties on axisHitCount break by location, then name, then kind", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "b.ts", name: "x", cognitive: 5, cyclomatic: 5 }),
      fn({ file: "a.ts", name: "y", cognitive: 5, cyclomatic: 5 }),
      fn({ file: "a.ts", name: "x", cognitive: 5, cyclomatic: 5 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const co = computeFunctionCoOccurrence(rankings);
    expect(co.map((e) => [e.ref.location, e.ref.name])).toEqual([
      ["a.ts:1", "x"],
      ["a.ts:1", "y"],
      ["b.ts:1", "x"],
    ]);
  });

  test("ties break by start line numerically, not lexicographically", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", line: 10, name: "f", cognitive: 5, cyclomatic: 5 }),
      fn({ file: "a.ts", line: 9, name: "f", cognitive: 5, cyclomatic: 5 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const co = computeFunctionCoOccurrence(rankings);
    expect(co.map((e) => e.ref.location)).toEqual(["a.ts:9", "a.ts:10"]);
  });

  test("respects --metrics-style filtering: only counts within filtered axes", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "wide",
        cognitive: 10,
        cyclomatic: 10,
        anyCount: 10,
      }),
    ];
    const full = rankFunctions(entries, { topN: 5 });
    const narrowed = filterFunctionRankings(full, [
      "cognitiveComplexity",
      "anyCount",
    ]);
    const co = computeFunctionCoOccurrence(narrowed);
    expect(co).toHaveLength(1);
    expect(co[0]?.axisHitCount).toBe(2);
    expect(co[0]?.axes).toEqual(["cognitiveComplexity", "anyCount"]);
  });

  test("empty rankings produce empty co-occurrence", () => {
    const co = computeFunctionCoOccurrence(emptyFunctionRankings());
    expect(co).toEqual([]);
  });
});

describe("computeFunctionAxisMeta", () => {
  test("nonZeroCount counts entries with non-zero value across all entries", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", cognitive: 5 }),
      fn({ file: "b.ts", name: "b", cognitive: 3 }),
      fn({ file: "c.ts", name: "c", cognitive: 0 }),
      fn({ file: "d.ts", name: "d", cognitive: 0, anyCount: 2 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.cognitiveComplexity.nonZeroCount).toBe(2);
    expect(meta.anyCount.nonZeroCount).toBe(1);
  });

  test("maxTieLength finds the longest run of equal values in top-N", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", line: 1, name: "a", cognitive: 5 }),
      fn({ file: "b.ts", line: 1, name: "b", cognitive: 5 }),
      fn({ file: "c.ts", line: 1, name: "c", cognitive: 5 }),
      fn({ file: "d.ts", line: 1, name: "d", cognitive: 3 }),
      fn({ file: "e.ts", line: 1, name: "e", cognitive: 3 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.cognitiveComplexity.maxTieLength).toBe(3);
  });

  test("topNSpread is max minus min across top-N values", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", cognitive: 10 }),
      fn({ file: "b.ts", name: "b", cognitive: 5 }),
      fn({ file: "c.ts", name: "c", cognitive: 1 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.cognitiveComplexity.topNSpread).toBe(9);
  });

  test("uniqueTopNValues counts distinct values in top-N", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", line: 1, name: "a", cognitive: 5 }),
      fn({ file: "b.ts", line: 1, name: "b", cognitive: 5 }),
      fn({ file: "c.ts", line: 1, name: "c", cognitive: 3 }),
      fn({ file: "d.ts", line: 1, name: "d", cognitive: 1 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.cognitiveComplexity.uniqueTopNValues).toBe(3);
  });

  test("empty rankings yield zero top-N meta but nonZeroCount from entries", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", cognitive: 5 }),
      fn({ file: "b.ts", name: "b" }),
    ];
    const meta = computeFunctionAxisMeta(entries, emptyFunctionRankings());
    expect(meta.cognitiveComplexity.nonZeroCount).toBe(1);
    expect(meta.cognitiveComplexity.maxTieLength).toBe(0);
    expect(meta.cognitiveComplexity.topNSpread).toBe(0);
    expect(meta.cognitiveComplexity.uniqueTopNValues).toBe(0);
  });

  test("tsSuppressionsFamily nonZeroCount sums across the three counters", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", tsIgnore: 1 }),
      fn({ file: "b.ts", name: "b", tsExpectError: 2 }),
      fn({ file: "c.ts", name: "c", tsNocheck: 3 }),
      fn({ file: "d.ts", name: "d" }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.tsSuppressionsFamily.nonZeroCount).toBe(3);
  });

  test("single-value top-N has spread 0 and tie length 1", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", cognitive: 7 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.cognitiveComplexity.topNSpread).toBe(0);
    expect(meta.cognitiveComplexity.maxTieLength).toBe(1);
    expect(meta.cognitiveComplexity.uniqueTopNValues).toBe(1);
  });
});

describe("computeFunctionHotspotCandidates", () => {
  test("A set: collects refs with axisHitCount >= 3", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        cyclomatic: 9,
        anyCount: 4,
      }),
      fn({ file: "b.ts", name: "two", cognitive: 8, cyclomatic: 7 }),
      fn({ file: "c.ts", name: "solo", cognitive: 6 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot).toBeDefined();
    expect(Object.keys(hot?.metrics ?? {})).toEqual([
      "cognitiveComplexity",
      "cyclomaticComplexity",
      "anyCount",
    ]);
    // "two" has only 2 axes → not in A; only 1 axis is discriminative so it
    // can still appear via B.
    const two = candidates.find((c) => c.ref.name === "two");
    expect(two).toBeDefined();
  });

  test("B set: top-3 of each discriminative axis become candidates", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", anyCount: 10 }),
      fn({ file: "b.ts", name: "b", anyCount: 5 }),
      fn({ file: "c.ts", name: "c", anyCount: 1 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.ref.name)).toEqual(["a", "b", "c"]);
    expect(candidates.every((c) => Object.keys(c.metrics).length === 1)).toBe(
      true,
    );
  });

  test("B set: non-discriminative axes (topNSpread=0 or uniqueTopNValues=1) are skipped", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "solo", anyCount: 5 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    expect(candidates).toEqual([]);
  });

  test("B set: only top-3 per axis even when --top is larger", () => {
    const entries: FunctionEntry[] = Array.from({ length: 5 }, (_, i) =>
      fn({ file: `f${String(i)}.ts`, name: `n${String(i)}`, anyCount: 10 - i }),
    );
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.ref.name)).toEqual(["n0", "n1", "n2"]);
  });

  test("merge A ∩ B: same ref in both sources has unioned axes", () => {
    const entries: FunctionEntry[] = [
      // "hot" hits 3 axes (→ A) and is top-1 in each of those discriminative
      // axes (→ B for each).
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        cyclomatic: 10,
        anyCount: 10,
      }),
      fn({ file: "b.ts", name: "b", cognitive: 5, cyclomatic: 4, anyCount: 3 }),
      fn({ file: "c.ts", name: "c", cognitive: 1, cyclomatic: 1, anyCount: 1 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot).toBeDefined();
    expect(Object.keys(hot?.metrics ?? {})).toEqual([
      "cognitiveComplexity",
      "cyclomaticComplexity",
      "anyCount",
    ]);
  });

  test("sort: hit-count desc, ties broken by location, name, kind", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "b.ts",
        name: "three",
        cognitive: 5,
        cyclomatic: 5,
        anyCount: 5,
      }),
      fn({
        file: "a.ts",
        name: "also-three",
        cognitive: 4,
        cyclomatic: 4,
        anyCount: 4,
      }),
      fn({
        file: "a.ts",
        name: "four",
        cognitive: 3,
        cyclomatic: 3,
        anyCount: 3,
        tsIgnore: 3,
      }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    // "four" has 4 axes → first. Ties at 3 broken by location asc.
    expect(candidates.map((c) => c.ref.name)).toEqual([
      "four",
      "also-three",
      "three",
    ]);
  });

  test("metrics: includes only keys for hit axes; tsSuppressionsFamily fans out to 3 keys", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        cyclomatic: 9,
        tsIgnore: 5,
      }),
      fn({ file: "b.ts", name: "b", cognitive: 5, cyclomatic: 4, tsIgnore: 2 }),
      fn({ file: "c.ts", name: "c", cognitive: 1, cyclomatic: 1, tsIgnore: 1 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot?.metrics).toEqual({
      cognitiveComplexity: 10,
      cyclomaticComplexity: 9,
      tsIgnoreCount: 5,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
    // anyCount axis was not hit → key must not be present.
    expect(Object.hasOwn(hot?.metrics ?? {}, "anyCount")).toBe(false);
  });

  test("--metrics filter closes candidate computation over the filtered axis set", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        cyclomatic: 9,
        anyCount: 4,
      }),
      fn({ file: "b.ts", name: "b", cognitive: 5, cyclomatic: 4, anyCount: 2 }),
      fn({ file: "c.ts", name: "c", cognitive: 1, cyclomatic: 1, anyCount: 1 }),
    ];
    const full = rankFunctions(entries, { topN: 5 });
    const narrowed = filterFunctionRankings(full, [
      "cognitiveComplexity",
      "cyclomaticComplexity",
    ]);
    const meta = computeFunctionAxisMeta(entries, narrowed);
    const co = computeFunctionCoOccurrence(narrowed);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      narrowed,
      meta,
      co,
    );
    // With anyCount filtered out: "hot" has 2 axes → not in A. B still picks
    // it (and "b", "c") because cognitive/cyclomatic are discriminative.
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot).toBeDefined();
    expect(Object.keys(hot?.metrics ?? {})).toEqual([
      "cognitiveComplexity",
      "cyclomaticComplexity",
    ]);
    // anyCount raw value must not leak into metrics.
    expect(Object.hasOwn(hot?.metrics ?? {}, "anyCount")).toBe(false);
  });

  test("empty inputs produce empty candidates", () => {
    expect(
      computeFunctionHotspotCandidates(
        [],
        emptyFunctionRankings(),
        computeFunctionAxisMeta([], emptyFunctionRankings()),
        [],
      ),
    ).toEqual([]);
  });

  test("leverage-only axis (callerCount) does not rescue candidates", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", callerCount: 10 }),
      fn({ file: "b.ts", name: "b", callerCount: 5 }),
      fn({ file: "c.ts", name: "c", callerCount: 1 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    expect(candidates).toEqual([]);
  });

  test("co-occurrence entry with no quality axis is rejected", () => {
    // Synthetic: a leverage-only co-occurrence entry is skipped even if
    // axisHitCount clears the min-axes gate. (Currently unreachable via real
    // rankings because there is only 1 leverage axis, but guards future growth.)
    const ref = {
      location: "a.ts:1",
      name: "solo",
      kind: "function" as const,
    };
    const candidates = computeFunctionHotspotCandidates(
      [
        {
          location: "a.ts:1",
          name: "solo",
          kind: "function",
          metrics: { callerCount: 10 },
          bodyHash: "sha256:solo",
        },
      ],
      emptyFunctionRankings(),
      computeFunctionAxisMeta([], emptyFunctionRankings()),
      [{ ref, axisHitCount: 3, axes: ["callerCount"] }],
    );
    expect(candidates).toEqual([]);
  });

  test("totalHits primary, qualityHits tiebreak when leverage amps", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "quality-only",
        cognitive: 10,
        cyclomatic: 10,
        anyCount: 10,
      }),
      fn({
        file: "b.ts",
        name: "quality-plus-leverage",
        cognitive: 5,
        cyclomatic: 5,
        callerCount: 10,
      }),
      fn({
        file: "c.ts",
        name: "all-four",
        cognitive: 1,
        cyclomatic: 1,
        anyCount: 1,
        callerCount: 1,
      }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    const co = computeFunctionCoOccurrence(rankings);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      rankings,
      meta,
      co,
    );
    // all-four: totalHits=4 (cog+cyc+any+callerCount), qualityHits=3
    // quality-only: totalHits=3 (cog+cyc+any), qualityHits=3
    // quality-plus-leverage: totalHits=3 (cog+cyc+callerCount), qualityHits=2
    // Sort: totalHits desc → all-four first. Then totalHits=3 tied, qualityHits
    // desc breaks in favor of quality-only over quality-plus-leverage.
    expect(candidates.map((c) => c.ref.name)).toEqual([
      "all-four",
      "quality-only",
      "quality-plus-leverage",
    ]);
    // Leverage axis appears in the candidate's metrics when it co-occurred.
    const leverageCandidate = candidates.find(
      (c) => c.ref.name === "quality-plus-leverage",
    );
    expect(Object.hasOwn(leverageCandidate?.metrics ?? {}, "callerCount")).toBe(
      true,
    );
  });
});

describe("filter rankings", () => {
  test("filterFunctionRankings keeps only listed axes, others are empty", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", cognitive: 5, cyclomatic: 7 }),
    ];
    const full = rankFunctions(entries, { topN: 5 });
    const filtered = filterFunctionRankings(full, ["cognitiveComplexity"]);
    expect(filtered.cognitiveComplexity).toHaveLength(1);
    expect(filtered.cyclomaticComplexity).toEqual([]);
  });
});
