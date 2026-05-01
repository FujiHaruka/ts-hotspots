import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { extractFragments } from "../indexer/extractFragments.ts";
import { parseSource } from "../../parser/parseSource.ts";
import { extractFeatures } from "./extractFeatures.ts";

describe("extractFeatures", () => {
  it("returns non-empty feature streams for a realistic function", () => {
    const src = `async function loadUser(id: string) {
  const user = await repo.findById(id);
  if (user === null) {
    throw new Error("not found");
  }
  return user.name;
}`;
    const parsed = parseSource("a.ts", src);
    const fragments = extractFragments(parsed, defaultConfig);
    const fn = fragments.find((f) => f.kind === "function");
    if (fn === undefined) throw new Error("no fn");
    const feats = extractFeatures(fn, parsed.sourceFile, defaultConfig);
    expect(feats.fragmentId).toBe(fn.id);
    expect(feats.tokens.length).toBeGreaterThan(0);
    expect(feats.statements.length).toBeGreaterThan(0);
    expect(feats.calls.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const src = `function f(xs: number[]) {
  const total = xs.reduce((a, b) => a + b, 0);
  if (total > 0) {
    return total;
  }
  return 0;
}`;
    const parsed = parseSource("a.ts", src);
    const fragments = extractFragments(parsed, defaultConfig);
    const fn = fragments.find((f) => f.kind === "function");
    if (fn === undefined) throw new Error("no fn");
    const a = extractFeatures(fn, parsed.sourceFile, defaultConfig);
    const b = extractFeatures(fn, parsed.sourceFile, defaultConfig);
    expect(a).toEqual(b);
  });

  it("does not crash on an empty function body", () => {
    const src = `function empty() {}
`;
    const parsed = parseSource("a.ts", src);
    const fragments = extractFragments(parsed, defaultConfig);
    const fn = fragments.find((f) => f.kind === "function");
    if (fn === undefined) throw new Error("no fn");
    const feats = extractFeatures(fn, parsed.sourceFile, defaultConfig);
    // No inner statements → no statement n-grams, no calls.
    expect(feats.statements).toEqual([]);
    expect(feats.calls).toEqual([]);
    // Token n-grams are allowed (the function signature itself produces
    // tokens like FUNCTION ID LPAREN RPAREN ...) but the call must not
    // throw and the result must be an array.
    expect(Array.isArray(feats.tokens)).toBe(true);
  });

  describe("features.enabled flags", () => {
    const src = `async function loadUser(id: string) {
  const user = await repo.findById(id);
  if (user === null) {
    throw new Error("not found");
  }
  return user.name;
}`;

    it("disabling token zeroes out only token stream", () => {
      const parsed = parseSource("a.ts", src);
      const fn = extractFragments(parsed, defaultConfig).find(
        (f) => f.kind === "function",
      );
      if (fn === undefined) throw new Error("no fn");
      const config = {
        ...defaultConfig,
        features: {
          ...defaultConfig.features,
          enabled: { token: false, statement: true, call: true },
        },
      };
      const feats = extractFeatures(fn, parsed.sourceFile, config);
      expect(feats.tokens).toEqual([]);
      expect(feats.statements.length).toBeGreaterThan(0);
      expect(feats.calls.length).toBeGreaterThan(0);
    });

    it("disabling statement zeroes out only statement stream", () => {
      const parsed = parseSource("a.ts", src);
      const fn = extractFragments(parsed, defaultConfig).find(
        (f) => f.kind === "function",
      );
      if (fn === undefined) throw new Error("no fn");
      const config = {
        ...defaultConfig,
        features: {
          ...defaultConfig.features,
          enabled: { token: true, statement: false, call: true },
        },
      };
      const feats = extractFeatures(fn, parsed.sourceFile, config);
      expect(feats.tokens.length).toBeGreaterThan(0);
      expect(feats.statements).toEqual([]);
      expect(feats.calls.length).toBeGreaterThan(0);
    });

    it("disabling call zeroes out only call stream", () => {
      const parsed = parseSource("a.ts", src);
      const fn = extractFragments(parsed, defaultConfig).find(
        (f) => f.kind === "function",
      );
      if (fn === undefined) throw new Error("no fn");
      const config = {
        ...defaultConfig,
        features: {
          ...defaultConfig.features,
          enabled: { token: true, statement: true, call: false },
        },
      };
      const feats = extractFeatures(fn, parsed.sourceFile, config);
      expect(feats.tokens.length).toBeGreaterThan(0);
      expect(feats.statements.length).toBeGreaterThan(0);
      expect(feats.calls).toEqual([]);
    });
  });

  it("two functions differing only by identifiers hit high token-ngram jaccard", () => {
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
    const pA = parseSource("a.ts", srcA);
    const pB = parseSource("b.ts", srcB);
    const fA = extractFragments(pA, defaultConfig).find(
      (f) => f.kind === "function",
    );
    const fB = extractFragments(pB, defaultConfig).find(
      (f) => f.kind === "function",
    );
    if (fA === undefined || fB === undefined) throw new Error("no fn");
    const a = extractFeatures(fA, pA.sourceFile, defaultConfig);
    const b = extractFeatures(fB, pB.sourceFile, defaultConfig);
    const setA = new Set(a.tokens);
    const setB = new Set(b.tokens);
    let inter = 0;
    for (const x of setA) {
      if (setB.has(x)) inter++;
    }
    const jaccard = inter / (setA.size + setB.size - inter);
    expect(jaccard).toBeGreaterThanOrEqual(0.7);
    // statement kinds should match exactly.
    expect(a.statements).toEqual(b.statements);
  });
});
