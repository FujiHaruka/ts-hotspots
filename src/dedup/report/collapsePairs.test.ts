import { describe, expect, it } from "vitest";
import type { CandidateScore } from "../domain/candidate.ts";
import type { Fragment, FragmentKind } from "../domain/fragment.ts";
import { collapsePairs } from "./collapsePairs.ts";
import type { ScoredPair } from "./jsonReport.ts";

interface FragSpec {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  kind?: FragmentKind;
}

function mkFragment(spec: FragSpec): Fragment {
  const kind = spec.kind ?? "function";
  return {
    id: spec.id,
    filePath: spec.filePath,
    startLine: spec.startLine,
    endLine: spec.endLine,
    kind,
    text: `// ${spec.id}`,
    astNodeKind:
      kind === "function"
        ? "FunctionDeclaration"
        : kind === "block"
          ? "IfStatement"
          : "StatementWindow",
  };
}

function mkScore(changedId: string, baseId: string): CandidateScore {
  return {
    changedFragmentId: changedId,
    baseFragmentId: baseId,
    combined: 0.5,
    breakdown: {
      tokenOverlap: 0.5,
      statementKindSimilarity: 0.5,
      callOverlap: 0.5,
      sizeCompatibility: 0.5,
      lengthScore: 0,
    },
  };
}

function mkPair(changed: FragSpec, base: FragSpec): ScoredPair {
  const changedFragment = mkFragment(changed);
  const baseFragment = mkFragment(base);
  return {
    score: mkScore(changedFragment.id, baseFragment.id),
    changedFragment,
    baseFragment,
    intersections: { tokens: [], statements: [], calls: [] },
  };
}

describe("collapsePairs", () => {
  it("drops an inner block pair when an enclosing function pair contains it on both sides", () => {
    const fnPair = mkPair(
      { id: "u1", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "function" },
      { id: "m1", filePath: "src/m.ts", startLine: 1, endLine: 20, kind: "function" },
    );
    const blockPair = mkPair(
      { id: "u2", filePath: "src/u.ts", startLine: 5, endLine: 10, kind: "block" },
      { id: "m2", filePath: "src/m.ts", startLine: 5, endLine: 10, kind: "block" },
    );

    const result = collapsePairs([blockPair, fnPair]);
    expect(result).toHaveLength(1);
    expect(result[0]?.changedFragment.id).toBe("u1");
  });

  it("collapses a 3-level nest (function ⊃ block ⊃ window) into only the function pair", () => {
    const fn = mkPair(
      { id: "cu-fn", filePath: "src/u.ts", startLine: 1, endLine: 30, kind: "function" },
      { id: "cm-fn", filePath: "src/m.ts", startLine: 1, endLine: 30, kind: "function" },
    );
    const blk = mkPair(
      { id: "cu-blk", filePath: "src/u.ts", startLine: 5, endLine: 20, kind: "block" },
      { id: "cm-blk", filePath: "src/m.ts", startLine: 5, endLine: 20, kind: "block" },
    );
    const win = mkPair(
      { id: "cu-win", filePath: "src/u.ts", startLine: 10, endLine: 14, kind: "window" },
      { id: "cm-win", filePath: "src/m.ts", startLine: 10, endLine: 14, kind: "window" },
    );

    const result = collapsePairs([win, blk, fn]);
    expect(result).toHaveLength(1);
    expect(result[0]?.changedFragment.kind).toBe("function");
  });

  it("keeps one-sided containment (changed is contained but base is not)", () => {
    const outer = mkPair(
      { id: "u-fn", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "function" },
      { id: "m-fn", filePath: "src/m.ts", startLine: 100, endLine: 120, kind: "function" },
    );
    const inner = mkPair(
      { id: "u-blk", filePath: "src/u.ts", startLine: 5, endLine: 10, kind: "block" },
      // base side points at a DIFFERENT region of src/m.ts
      { id: "m-blk", filePath: "src/m.ts", startLine: 200, endLine: 210, kind: "block" },
    );

    const result = collapsePairs([outer, inner]);
    expect(result).toHaveLength(2);
  });

  it("does not collapse across different (changed, base) file buckets", () => {
    const a = mkPair(
      { id: "u-fn", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "function" },
      { id: "m-fn", filePath: "src/m.ts", startLine: 1, endLine: 20, kind: "function" },
    );
    const b = mkPair(
      // different base file — even though ranges are nested, the bucket differs
      { id: "u-blk", filePath: "src/u.ts", startLine: 5, endLine: 10, kind: "block" },
      { id: "x-blk", filePath: "src/x.ts", startLine: 5, endLine: 10, kind: "block" },
    );

    const result = collapsePairs([a, b]);
    expect(result).toHaveLength(2);
  });

  it("breaks range-equal ties by kind priority (function > block > window)", () => {
    const asFn = mkPair(
      { id: "u-fn", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "function" },
      { id: "m-fn", filePath: "src/m.ts", startLine: 1, endLine: 20, kind: "function" },
    );
    const asBlk = mkPair(
      { id: "u-blk", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "block" },
      { id: "m-blk", filePath: "src/m.ts", startLine: 1, endLine: 20, kind: "block" },
    );
    const asWin = mkPair(
      { id: "u-win", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "window" },
      { id: "m-win", filePath: "src/m.ts", startLine: 1, endLine: 20, kind: "window" },
    );

    // Input order shuffled to stress ordering, not insertion.
    const result = collapsePairs([asWin, asBlk, asFn]);
    expect(result).toHaveLength(1);
    expect(result[0]?.changedFragment.kind).toBe("function");
  });

  it("returns [] on empty input", () => {
    expect(collapsePairs([])).toEqual([]);
  });

  it("is deterministic across repeated runs", () => {
    const pairs: ScoredPair[] = [
      mkPair(
        { id: "u-fn", filePath: "src/u.ts", startLine: 1, endLine: 20, kind: "function" },
        { id: "m-fn", filePath: "src/m.ts", startLine: 1, endLine: 20, kind: "function" },
      ),
      mkPair(
        { id: "u-blk", filePath: "src/u.ts", startLine: 5, endLine: 10, kind: "block" },
        { id: "m-blk", filePath: "src/m.ts", startLine: 5, endLine: 10, kind: "block" },
      ),
      mkPair(
        { id: "u-other", filePath: "src/u.ts", startLine: 30, endLine: 40, kind: "function" },
        { id: "x-fn", filePath: "src/x.ts", startLine: 1, endLine: 11, kind: "function" },
      ),
    ];
    const a = collapsePairs(pairs);
    const b = collapsePairs([...pairs].toReversed());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
