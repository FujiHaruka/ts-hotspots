import { describe, expect, it } from "vitest";
import { parseSource } from "../../parser/parseSource.ts";
import { defaultConfig } from "../config/index.ts";
import type { Candidate } from "../domain/candidate.ts";
import type { FragmentFeatures } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFeatures } from "../features/extractFeatures.ts";
import { extractFragments } from "../indexer/extractFragments.ts";
import { buildFeatureSets } from "./featureSets.ts";
import { scoreCandidateDetailedFromSets } from "./scoreCandidate.ts";

interface Pair {
  fragment: Fragment;
  features: FragmentFeatures;
}

function firstFunction(src: string, filePath: string): Pair {
  const parsed = parseSource(filePath, src);
  const fragments = extractFragments(parsed, defaultConfig);
  const fn = fragments.find((f) => f.kind === "function");
  if (fn === undefined) throw new Error("no function fragment");
  const features = extractFeatures(fn, parsed.sourceFile, defaultConfig);
  return { fragment: fn, features };
}

function scoreFor(changed: Pair, base: Pair) {
  const candidate: Candidate = {
    changedFragmentId: changed.fragment.id,
    baseFragmentId: base.fragment.id,
    hitCounts: { token: 0, statement: 0, call: 0 },
  };
  return scoreCandidateDetailedFromSets(
    {
      candidate,
      changedFragment: changed.fragment,
      baseFragment: base.fragment,
      changedFeatureSets: buildFeatureSets(changed.features),
      baseFeatureSets: buildFeatureSets(base.features),
    },
    defaultConfig,
  );
}

describe("scoreCandidateDetailedFromSets — combined score", () => {
  it("identical copies produce a high combined score (>= 0.85)", () => {
    const src = `async function loadUser(id: string) {
  const user = await repo.findById(id);
  if (user === null) {
    throw new Error("not found");
  }
  return user.name;
}`;
    const a = firstFunction(src, "a.ts");
    const b = firstFunction(src, "b.ts");
    const { score } = scoreFor(a, b);
    // Length bonus is < 1 for a 7-line fragment (saturation at 80), so the
    // combined score lands below 0.9 even with all 4 similarity axes at 1.
    expect(score.combined).toBeGreaterThanOrEqual(0.85);
    expect(score.breakdown.tokenOverlap).toBe(1);
    expect(score.breakdown.statementKindSimilarity).toBe(1);
    expect(score.breakdown.callOverlap).toBe(1);
    expect(score.breakdown.sizeCompatibility).toBe(1);
    expect(score.breakdown.lengthScore).toBeGreaterThan(0);
    expect(score.breakdown.lengthScore).toBeLessThan(1);
    expect(score.changedFragmentId).toBe(a.fragment.id);
    expect(score.baseFragmentId).toBe(b.fragment.id);
  });

  it("identifier-only changes keep token and statement scores high", () => {
    const srcA = `function f(x: number, y: number) {
  const sum = x + y;
  if (sum > 0) {
    return sum;
  }
  return -sum;
}`;
    const srcB = `function g(a: number, b: number) {
  const total = a + b;
  if (total > 0) {
    return total;
  }
  return -total;
}`;
    const a = firstFunction(srcA, "a.ts");
    const b = firstFunction(srcB, "b.ts");
    const { score } = scoreFor(a, b);
    expect(score.breakdown.tokenOverlap).toBeGreaterThanOrEqual(0.7);
    expect(score.breakdown.statementKindSimilarity).toBe(1);
    expect(score.combined).toBeGreaterThan(0.5);
  });

  it("sizeCompatibility reflects a 10x fragment size gap", () => {
    const shortSrc = `function tiny() {
  return 1;
}`;
    const longSrc = `function big() {
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  const e = 5;
  const f = 6;
  const g = 7;
  const h = 8;
  const i = 9;
  const j = 10;
  const k = 11;
  const l = 12;
  const m = 13;
  const n = 14;
  const o = 15;
  const p = 16;
  const q = 17;
  const r = 18;
  const s = 19;
  const t = 20;
  const u = 21;
  const v = 22;
  const w = 23;
  const x = 24;
  const y = 25;
  const z = 26;
  const aa = 27;
  return a + z;
}`;
    const a = firstFunction(shortSrc, "a.ts");
    const b = firstFunction(longSrc, "b.ts");
    const { score } = scoreFor(a, b);
    expect(score.breakdown.sizeCompatibility).toBeLessThanOrEqual(0.2);
  });

  it("blends Jaccard with overlap coefficient when both fragments are long", () => {
    // Both fragments long enough (>= containment.minLines = 20) to trigger
    // the blend. tokens of A ⊂ tokens of B → overlapCoef = 1, blended ≈ 0.85,
    // Jaccard = 3/8 ≈ 0.375. blend should pick the larger, ≈ 0.85.
    const candidate: Candidate = {
      changedFragmentId: "c",
      baseFragmentId: "b",
      hitCounts: { token: 0, statement: 0, call: 0 },
    };
    const changedFragment: Fragment = {
      id: "c",
      filePath: "c.ts",
      startLine: 1,
      endLine: 30, // 30 lines >= 20
      kind: "function",
      text: "",
      astNodeKind: "FunctionDeclaration",
    };
    const baseFragment: Fragment = {
      ...changedFragment,
      id: "b",
      filePath: "b.ts",
      endLine: 60, // 60 lines >= 20
    };
    const result = scoreCandidateDetailedFromSets(
      {
        candidate,
        changedFragment,
        baseFragment,
        changedFeatureSets: buildFeatureSets({
          fragmentId: "c",
          tokens: ["token:A", "token:B", "token:C"],
          statements: ["statement:S1"],
          calls: ["call:CALL:foo"],
        }),
        baseFeatureSets: buildFeatureSets({
          fragmentId: "b",
          tokens: [
            "token:A",
            "token:B",
            "token:C",
            "token:D",
            "token:E",
            "token:F",
            "token:G",
            "token:H",
          ],
          statements: ["statement:S1", "statement:S2"],
          calls: ["call:CALL:foo", "call:CALL:bar"],
        }),
      },
      defaultConfig,
    );
    expect(result.score.breakdown.tokenOverlap).toBeCloseTo(0.85, 6);
    expect(result.score.breakdown.statementKindSimilarity).toBeCloseTo(0.85, 6);
    expect(result.score.breakdown.callOverlap).toBeCloseTo(0.85, 6);
  });

  it("does NOT blend when either fragment is below containment.minLines", () => {
    // Same set shapes as above (A ⊂ B), but fragments are 10 lines each
    // — below the 20-line containment threshold. Score falls back to plain
    // Jaccard (3/8 ≈ 0.375 for tokens, 1/2 for the others).
    const candidate: Candidate = {
      changedFragmentId: "c",
      baseFragmentId: "b",
      hitCounts: { token: 0, statement: 0, call: 0 },
    };
    const changedFragment: Fragment = {
      id: "c",
      filePath: "c.ts",
      startLine: 1,
      endLine: 10,
      kind: "function",
      text: "",
      astNodeKind: "FunctionDeclaration",
    };
    const baseFragment: Fragment = {
      ...changedFragment,
      id: "b",
      filePath: "b.ts",
      endLine: 10,
    };
    const result = scoreCandidateDetailedFromSets(
      {
        candidate,
        changedFragment,
        baseFragment,
        changedFeatureSets: buildFeatureSets({
          fragmentId: "c",
          tokens: ["token:A", "token:B", "token:C"],
          statements: ["statement:S1"],
          calls: ["call:CALL:foo"],
        }),
        baseFeatureSets: buildFeatureSets({
          fragmentId: "b",
          tokens: [
            "token:A",
            "token:B",
            "token:C",
            "token:D",
            "token:E",
            "token:F",
            "token:G",
            "token:H",
          ],
          statements: ["statement:S1", "statement:S2"],
          calls: ["call:CALL:foo", "call:CALL:bar"],
        }),
      },
      defaultConfig,
    );
    expect(result.score.breakdown.tokenOverlap).toBeCloseTo(3 / 8, 6);
    expect(result.score.breakdown.statementKindSimilarity).toBeCloseTo(
      1 / 2,
      6,
    );
    expect(result.score.breakdown.callOverlap).toBeCloseTo(1 / 2, 6);
  });

  it("ignores bag multiplicity — scores are set-based", () => {
    const candidate: Candidate = {
      changedFragmentId: "c",
      baseFragmentId: "b",
      hitCounts: { token: 0, statement: 0, call: 0 },
    };
    const changedFragment: Fragment = {
      id: "c",
      filePath: "c.ts",
      startLine: 1,
      endLine: 5,
      kind: "function",
      text: "",
      astNodeKind: "FunctionDeclaration",
    };
    const baseFragment: Fragment = {
      ...changedFragment,
      id: "b",
      filePath: "b.ts",
    };
    const result = scoreCandidateDetailedFromSets(
      {
        candidate,
        changedFragment,
        baseFragment,
        changedFeatureSets: buildFeatureSets({
          fragmentId: "c",
          tokens: ["token:A", "token:A", "token:B"],
          statements: ["statement:X"],
          calls: ["call:CALL:foo", "call:CALL:foo"],
        }),
        baseFeatureSets: buildFeatureSets({
          fragmentId: "b",
          tokens: ["token:A", "token:B"],
          statements: ["statement:X"],
          calls: ["call:CALL:foo"],
        }),
      },
      defaultConfig,
    );
    expect(result.score.breakdown.tokenOverlap).toBe(1);
    expect(result.score.breakdown.statementKindSimilarity).toBe(1);
    expect(result.score.breakdown.callOverlap).toBe(1);
  });
});

describe("scoreCandidateDetailedFromSets — intersections", () => {
  it("returns the shared keys per axis, ascending-sorted", () => {
    const src = `async function loadUser(id: string) {
  const user = await repo.findById(id);
  if (user === null) {
    throw new Error("not found");
  }
  return user.name;
}`;
    const a = firstFunction(src, "a.ts");
    const b = firstFunction(src, "b.ts");
    const { score, intersections } = scoreFor(a, b);

    expect(score.combined).toBeGreaterThanOrEqual(0.85);

    const uniqSorted = (xs: string[]): string[] =>
      Array.from(new Set(xs)).sort();
    expect(intersections.tokens).toEqual(uniqSorted(a.features.tokens));
    expect(intersections.statements).toEqual(uniqSorted(a.features.statements));
    expect(intersections.calls).toEqual(uniqSorted(a.features.calls));

    const sortedCopy = [...intersections.tokens].sort();
    expect(intersections.tokens).toEqual(sortedCopy);
  });

  it("returns only the shared keys for partial overlap", () => {
    const changedFragment: Fragment = {
      id: "c",
      filePath: "c.ts",
      startLine: 1,
      endLine: 5,
      kind: "function",
      text: "",
      astNodeKind: "FunctionDeclaration",
    };
    const baseFragment: Fragment = {
      ...changedFragment,
      id: "b",
      filePath: "b.ts",
    };
    const candidate: Candidate = {
      changedFragmentId: "c",
      baseFragmentId: "b",
      hitCounts: { token: 0, statement: 0, call: 0 },
    };
    const { intersections } = scoreCandidateDetailedFromSets(
      {
        candidate,
        changedFragment,
        baseFragment,
        changedFeatureSets: buildFeatureSets({
          fragmentId: "c",
          tokens: ["token:B", "token:A", "token:C"],
          statements: ["statement:S1", "statement:S2"],
          calls: ["call:CALL:x", "call:CALL:y"],
        }),
        baseFeatureSets: buildFeatureSets({
          fragmentId: "b",
          tokens: ["token:A", "token:C", "token:D"],
          statements: ["statement:S2", "statement:S3"],
          calls: ["call:CALL:y", "call:CALL:z"],
        }),
      },
      defaultConfig,
    );
    expect(intersections.tokens).toEqual(["token:A", "token:C"]);
    expect(intersections.statements).toEqual(["statement:S2"]);
    expect(intersections.calls).toEqual(["call:CALL:y"]);
  });
});
