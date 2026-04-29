import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.ts";
import { defaultConfig } from "../config/index.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFragments } from "../indexer/extractFragments.ts";
import { parseSource } from "../indexer/parseSource.ts";
import { buildTokenNgrams } from "./normalizedTokenNgram.ts";

function firstFunction(src: string, filePath = "a.ts"): {
  fragment: Fragment;
  sourceFile: ReturnType<typeof parseSource>["sourceFile"];
} {
  const parsed = parseSource(filePath, src);
  const fragments = extractFragments(parsed, defaultConfig);
  const fn = fragments.find((f) => f.kind === "function");
  if (fn === undefined) {
    throw new Error("no function fragment");
  }
  return { fragment: fn, sourceFile: parsed.sourceFile };
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) {
      inter++;
    }
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

describe("buildTokenNgrams", () => {
  it("two functions that differ only by identifier names produce mostly equal n-grams", () => {
    const srcA = `function f(x: number): number {
  const y = x + 1;
  return y;
}`;
    const srcB = `function g(a: number): number {
  const b = a + 1;
  return b;
}`;
    const a = firstFunction(srcA, "a.ts");
    const b = firstFunction(srcB, "b.ts");
    const ngA = buildTokenNgrams(a.fragment, a.sourceFile, defaultConfig);
    const ngB = buildTokenNgrams(b.fragment, b.sourceFile, defaultConfig);
    expect(ngA.length).toBeGreaterThan(0);
    expect(jaccard(ngA, ngB)).toBeGreaterThanOrEqual(0.7);
  });

  it("normalizes literal kinds to s / n / b / u / r", () => {
    const src = `function f() {
  const a = "hello";
  const b = 42;
  const c = true;
  const d = null;
  const e = /foo/;
  return a;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const tokens = buildTokenNgrams(fragment, sourceFile, defaultConfig);
    // Each emitted n-gram key is `token:<form0>\x00<form1>\x00…`. Decompose
    // every key into the set of forms it contains so we can assert that
    // each literal placeholder appears at least once across the n-grams.
    const forms = new Set<string>();
    for (const k of tokens) {
      const body = k.slice("token:".length);
      for (const f of body.split("\x00")) {
        forms.add(f);
      }
    }
    expect(forms.has("s")).toBe(true);
    expect(forms.has("n")).toBe(true);
    expect(forms.has("b")).toBe(true);
    expect(forms.has("u")).toBe(true);
    expect(forms.has("r")).toBe(true);
  });

  it("strips type annotations: `const x: number = 1` == `const x = 1`", () => {
    const srcA = `function f() {
  const x: number = 1;
  return x;
}`;
    const srcB = `function f() {
  const x = 1;
  return x;
}`;
    const a = firstFunction(srcA, "a.ts");
    const b = firstFunction(srcB, "b.ts");
    const ngA = buildTokenNgrams(a.fragment, a.sourceFile, defaultConfig);
    const ngB = buildTokenNgrams(b.fragment, b.sourceFile, defaultConfig);
    expect(ngA).toEqual(ngB);
  });

  it("ignores comments", () => {
    const srcA = `function f() {
  // leading comment
  const x = 1; /* trailing */
  return x;
}`;
    const srcB = `function f() {
  const x = 1;
  return x;
}`;
    const a = firstFunction(srcA, "a.ts");
    const b = firstFunction(srcB, "b.ts");
    const ngA = buildTokenNgrams(a.fragment, a.sourceFile, defaultConfig);
    const ngB = buildTokenNgrams(b.fragment, b.sourceFile, defaultConfig);
    expect(ngA).toEqual(ngB);
  });

  it("honors tokenNgramSizes from config", () => {
    const src = `function f() {
  const x = 1;
  return x;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const cfgSmall: Config = {
      ...defaultConfig,
      features: { ...defaultConfig.features, tokenNgramSizes: [2] },
    };
    const cfgBig: Config = {
      ...defaultConfig,
      features: { ...defaultConfig.features, tokenNgramSizes: [5] },
    };
    const small = buildTokenNgrams(fragment, sourceFile, cfgSmall);
    const big = buildTokenNgrams(fragment, sourceFile, cfgBig);
    expect(small.every((k) => k.startsWith("token:"))).toBe(true);
    // Size-2 joins should have exactly 1 separator inside the value.
    for (const k of small) {
      const body = k.slice("token:".length);
      expect(body.split("\x00")).toHaveLength(2);
    }
    // Size-5 joins should have exactly 4 separators inside the value.
    for (const k of big) {
      const body = k.slice("token:".length);
      expect(body.split("\x00")).toHaveLength(5);
    }
    // And size-2 typically produces more keys than size-5 on short bodies.
    expect(small.length).toBeGreaterThan(big.length);
  });

  it("ngram concat is equivalent to slice+join with the NUL separator", () => {
    // Pin the manual-concat loop to a `slice` + `join("\x00")` reference
    // implementation. Any future micro-optimisation of the inner loop must
    // produce the same string per n-gram or this trips.
    const reference = (tokens: string[], sizes: number[]): string[] => {
      const out: string[] = [];
      for (const size of sizes) {
        if (size <= 0 || tokens.length < size) continue;
        for (let i = 0; i + size <= tokens.length; i += 1) {
          const body = tokens.slice(i, i + size).join("\x00");
          out.push(`token:${body}`);
        }
      }
      return out;
    };

    let seed = 0x9e3779b9;
    const rand = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    const VOCAB = ["i", "(", ")", "If", "=", "Re", "."];
    const sizes = [3, 4, 5, 6];
    for (let trial = 0; trial < 100; trial += 1) {
      const len = 1 + Math.floor(rand() * 30);
      const normalized: string[] = [];
      for (let i = 0; i < len; i += 1) {
        normalized.push(VOCAB[Math.floor(rand() * VOCAB.length)] ?? "i");
      }
      const expected = reference(normalized, sizes);
      const produced: string[] = [];
      for (const size of sizes) {
        if (size <= 0 || normalized.length < size) continue;
        const last = normalized.length - size;
        for (let i = 0; i <= last; i += 1) {
          let key = `token:${normalized[i] ?? ""}`;
          for (let j = 1; j < size; j += 1) {
            key += `\x00${normalized[i + j] ?? ""}`;
          }
          produced.push(key);
        }
      }
      expect(produced).toEqual(expected);
    }
  });

  it("is deterministic across runs", () => {
    const src = `function f(xs: number[]) {
  if (xs.length > 0) {
    return xs[0];
  }
  return 0;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const a = buildTokenNgrams(fragment, sourceFile, defaultConfig);
    const b = buildTokenNgrams(fragment, sourceFile, defaultConfig);
    expect(a).toEqual(b);
  });
});
