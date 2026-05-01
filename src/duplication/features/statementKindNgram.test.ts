import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.ts";
import { defaultConfig } from "../config/index.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFragments } from "../indexer/extractFragments.ts";
import { parseSource } from "../../parser/parseSource.ts";
import { buildStatementKindNgrams } from "./statementKindNgram.ts";

function allFragments(
  src: string,
  filePath = "a.ts",
): {
  fragments: Fragment[];
  sourceFile: ReturnType<typeof parseSource>["sourceFile"];
} {
  const parsed = parseSource(filePath, src);
  const fragments = extractFragments(parsed, defaultConfig);
  return { fragments, sourceFile: parsed.sourceFile };
}

describe("buildStatementKindNgrams", () => {
  it("produces statement kind 2-grams over the direct statements of a function body", () => {
    const src = `function f(x: number) {
  const a = 1;
  if (x > 0) { return 1; }
  return 2;
}`;
    const { fragments, sourceFile } = allFragments(src);
    const fn = fragments.find((f) => f.kind === "function");
    if (fn === undefined) throw new Error("no fn");
    const keys = buildStatementKindNgrams(fn, sourceFile, defaultConfig);
    expect(keys).toContain("statement:VariableStatement|IfStatement");
    expect(keys).toContain("statement:IfStatement|ReturnStatement");
  });

  it("is invariant under identifier / literal changes", () => {
    const srcA = `function f(x: number) {
  const a = 1;
  if (x > 0) { return 1; }
  return 2;
}`;
    const srcB = `function g(y: number) {
  const z = 99;
  if (y > 5) { return 100; }
  return 200;
}`;
    const A = allFragments(srcA, "a.ts");
    const B = allFragments(srcB, "b.ts");
    const fa = A.fragments.find((f) => f.kind === "function");
    const fb = B.fragments.find((f) => f.kind === "function");
    if (fa === undefined || fb === undefined) throw new Error("no fn");
    const a = buildStatementKindNgrams(fa, A.sourceFile, defaultConfig);
    const b = buildStatementKindNgrams(fb, B.sourceFile, defaultConfig);
    expect(a).toEqual(b);
  });

  it("treats nested blocks as single elements from the outer fragment's view", () => {
    const src = `function f(x: number) {
  const a = 1;
  if (x > 0) {
    const inner1 = 10;
    const inner2 = 20;
    if (inner1 > inner2) {
      return inner1;
    }
  }
  return a;
}`;
    const { fragments, sourceFile } = allFragments(src);
    const fn = fragments.find((f) => f.kind === "function");
    if (fn === undefined) throw new Error("no fn");
    const keys = buildStatementKindNgrams(fn, sourceFile, defaultConfig);
    // Outer view: [VariableStatement, IfStatement, ReturnStatement].
    expect(keys).toContain(
      "statement:VariableStatement|IfStatement|ReturnStatement",
    );
    // No inner VariableStatement|VariableStatement should appear at the
    // outer function's level.
    expect(
      keys.some((k) => k === "statement:VariableStatement|VariableStatement"),
    ).toBe(false);
  });

  it("returns empty when not enough statements for any configured n-gram size", () => {
    const src = `function f() {
  return 1;
}`;
    const { fragments, sourceFile } = allFragments(src);
    const fn = fragments.find((f) => f.kind === "function");
    if (fn === undefined) throw new Error("no fn");
    // Default sizes start at 2; with only 1 statement we get nothing.
    const keys = buildStatementKindNgrams(fn, sourceFile, defaultConfig);
    expect(keys).toEqual([]);

    // Lowering the size to 1 produces the single-statement key.
    const cfg: Config = {
      ...defaultConfig,
      features: { ...defaultConfig.features, statementNgramSizes: [1] },
    };
    const keys1 = buildStatementKindNgrams(fn, sourceFile, cfg);
    expect(keys1).toContain("statement:ReturnStatement");
  });
});
