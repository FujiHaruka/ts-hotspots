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
  sloc?: number;
  paramCount?: number;
  mutationSiteCount?: number;
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
      cognitiveComplexity: opts.cognitive ?? 0,
      sloc: opts.sloc ?? 0,
      parameterCount: opts.paramCount ?? 0,
      maxNestingDepth: 0,
      callerCount: opts.callerCount ?? 0,
      calleeCount: 0,
      tryCatchCount: 0,
      awaitCount: 0,
      mutationSiteCount: opts.mutationSiteCount ?? 0,
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

  test("empty input returns empty arrays for all axes", () => {
    const rankings = rankFunctions([], { topN: 5 });
    expect(rankings.cognitiveComplexity).toEqual([]);
    expect(rankings.parameterCount).toEqual([]);
  });

  test("all-zero input returns empty array for each axis", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts" }),
      fn({ file: "b.ts" }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    expect(rankings.cognitiveComplexity).toEqual([]);
    expect(rankings.parameterCount).toEqual([]);
  });
});

describe("dedup collectors", () => {
  test("collectFunctionRefKeys dedups across axes", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "x", cognitive: 5, sloc: 5 }),
      fn({ file: "b.ts", name: "y", cognitive: 2, paramCount: 7 }),
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
        sloc: 9,
        paramCount: 4,
        mutationSiteCount: 3,
      }),
      fn({ file: "b.ts", name: "two", cognitive: 8, sloc: 7 }),
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
      "sloc",
      "parameterCount",
      "mutationSiteCount",
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
        paramCount: 5,
        cognitive: 5,
        mutationSiteCount: 5,
        sloc: 5,
      }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const co = computeFunctionCoOccurrence(rankings);
    expect(co[0]?.axes).toEqual([
      "cognitiveComplexity",
      "sloc",
      "parameterCount",
      "mutationSiteCount",
    ]);
  });

  test("ties on axisHitCount break by location, then name, then kind", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "b.ts", name: "x", cognitive: 5, sloc: 5 }),
      fn({ file: "a.ts", name: "y", cognitive: 5, sloc: 5 }),
      fn({ file: "a.ts", name: "x", cognitive: 5, sloc: 5 }),
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
      fn({ file: "a.ts", line: 10, name: "f", cognitive: 5, sloc: 5 }),
      fn({ file: "a.ts", line: 9, name: "f", cognitive: 5, sloc: 5 }),
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
        sloc: 10,
        paramCount: 10,
      }),
    ];
    const full = rankFunctions(entries, { topN: 5 });
    const narrowed = filterFunctionRankings(full, [
      "cognitiveComplexity",
      "parameterCount",
    ]);
    const co = computeFunctionCoOccurrence(narrowed);
    expect(co).toHaveLength(1);
    expect(co[0]?.axisHitCount).toBe(2);
    expect(co[0]?.axes).toEqual(["cognitiveComplexity", "parameterCount"]);
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
      fn({ file: "d.ts", name: "d", cognitive: 0, paramCount: 2 }),
    ];
    const rankings = rankFunctions(entries, { topN: 5 });
    const meta = computeFunctionAxisMeta(entries, rankings);
    expect(meta.cognitiveComplexity.nonZeroCount).toBe(2);
    expect(meta.parameterCount.nonZeroCount).toBe(1);
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
        sloc: 9,
        paramCount: 4,
      }),
      fn({ file: "b.ts", name: "two", cognitive: 8, sloc: 7 }),
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
      "sloc",
      "parameterCount",
    ]);
    // "two" has only 2 axes → not in A; only 1 axis is discriminative so it
    // can still appear via B.
    const two = candidates.find((c) => c.ref.name === "two");
    expect(two).toBeDefined();
  });

  test("B set: top-3 of each discriminative axis become candidates", () => {
    const entries: FunctionEntry[] = [
      fn({ file: "a.ts", name: "a", paramCount: 10 }),
      fn({ file: "b.ts", name: "b", paramCount: 5 }),
      fn({ file: "c.ts", name: "c", paramCount: 1 }),
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
      fn({ file: "a.ts", name: "solo", paramCount: 5 }),
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
      fn({
        file: `f${String(i)}.ts`,
        name: `n${String(i)}`,
        paramCount: 10 - i,
      }),
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
        sloc: 10,
        paramCount: 10,
      }),
      fn({
        file: "b.ts",
        name: "b",
        cognitive: 5,
        sloc: 4,
        paramCount: 3,
      }),
      fn({
        file: "c.ts",
        name: "c",
        cognitive: 1,
        sloc: 1,
        paramCount: 1,
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
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot).toBeDefined();
    expect(Object.keys(hot?.metrics ?? {})).toEqual([
      "cognitiveComplexity",
      "sloc",
      "parameterCount",
    ]);
  });

  test("sort: hit-count desc, ties broken by location, name, kind", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "b.ts",
        name: "three",
        cognitive: 5,
        sloc: 5,
        paramCount: 5,
      }),
      fn({
        file: "a.ts",
        name: "also-three",
        cognitive: 4,
        sloc: 4,
        paramCount: 4,
      }),
      fn({
        file: "a.ts",
        name: "four",
        cognitive: 3,
        sloc: 3,
        paramCount: 3,
        mutationSiteCount: 3,
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

  test("metrics: includes only keys for hit axes", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        sloc: 9,
        mutationSiteCount: 5,
      }),
      fn({
        file: "b.ts",
        name: "b",
        cognitive: 5,
        sloc: 4,
        mutationSiteCount: 2,
      }),
      fn({
        file: "c.ts",
        name: "c",
        cognitive: 1,
        sloc: 1,
        mutationSiteCount: 1,
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
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot?.metrics).toEqual({
      cognitiveComplexity: 10,
      sloc: 9,
      mutationSiteCount: 5,
    });
    // parameterCount axis was not hit → key must not be present.
    expect(Object.hasOwn(hot?.metrics ?? {}, "parameterCount")).toBe(false);
  });

  test("--metrics filter closes candidate computation over the filtered axis set", () => {
    const entries: FunctionEntry[] = [
      fn({
        file: "a.ts",
        name: "hot",
        cognitive: 10,
        sloc: 9,
        paramCount: 4,
      }),
      fn({
        file: "b.ts",
        name: "b",
        cognitive: 5,
        sloc: 4,
        paramCount: 2,
      }),
      fn({
        file: "c.ts",
        name: "c",
        cognitive: 1,
        sloc: 1,
        paramCount: 1,
      }),
    ];
    const full = rankFunctions(entries, { topN: 5 });
    const narrowed = filterFunctionRankings(full, [
      "cognitiveComplexity",
      "sloc",
    ]);
    const meta = computeFunctionAxisMeta(entries, narrowed);
    const co = computeFunctionCoOccurrence(narrowed);
    const candidates = computeFunctionHotspotCandidates(
      entries,
      narrowed,
      meta,
      co,
    );
    // With parameterCount filtered out: "hot" has 2 axes → not in A. B still
    // picks it (and "b", "c") because cognitive/sloc are discriminative.
    const hot = candidates.find((c) => c.ref.name === "hot");
    expect(hot).toBeDefined();
    expect(Object.keys(hot?.metrics ?? {})).toEqual([
      "cognitiveComplexity",
      "sloc",
    ]);
    // parameterCount raw value must not leak into metrics.
    expect(Object.hasOwn(hot?.metrics ?? {}, "parameterCount")).toBe(false);
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
    // axisHitCount clears the min-axes gate.
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
        sloc: 10,
        paramCount: 10,
      }),
      fn({
        file: "b.ts",
        name: "quality-plus-leverage",
        cognitive: 5,
        sloc: 5,
        callerCount: 10,
      }),
      fn({
        file: "c.ts",
        name: "all-four",
        cognitive: 1,
        sloc: 1,
        paramCount: 1,
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
    // all-four: totalHits=4 (cog+cyc+param+callerCount), qualityHits=3
    // quality-only: totalHits=3 (cog+cyc+param), qualityHits=3
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
      fn({ file: "a.ts", cognitive: 5, sloc: 7 }),
    ];
    const full = rankFunctions(entries, { topN: 5 });
    const filtered = filterFunctionRankings(full, ["cognitiveComplexity"]);
    expect(filtered.cognitiveComplexity).toHaveLength(1);
    expect(filtered.sloc).toEqual([]);
  });
});
