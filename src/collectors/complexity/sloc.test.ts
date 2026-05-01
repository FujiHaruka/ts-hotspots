import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { mkSourceFiles } from "../internal/mkSourceFiles.test-helper.ts";
import { parseFirstFunctionLike } from "../internal/parseFirstFunctionLike.test-helper.ts";
import { computeSloc, slocCollector } from "./sloc.ts";

function compute(src: string): number {
  const { sourceFile, fn } = parseFirstFunctionLike(src);
  return computeSloc(fn, sourceFile);
}

describe("computeSloc", () => {
  test("empty single-line body → 1", () => {
    expect(compute("function f(){}")).toBe(1);
  });

  test("multi-line empty body → 2", () => {
    expect(compute("function f(){\n}")).toBe(2);
  });

  test("simple function with 3 code lines → 4 (incl. brace lines)", () => {
    // Counts every non-blank, non-comment-only line in the function span:
    // `function f(){`, `const x = 1;`, `return x;`, `}` = 4.
    const src = ["function f(){", "  const x = 1;", "  return x;", "}"].join(
      "\n",
    );
    expect(compute(src)).toBe(4);
  });

  test("blank lines between statements are not counted", () => {
    // 4 non-blank lines (header, const, return, `}`), blank line ignored.
    const src = [
      "function f(){",
      "  const x = 1;",
      "",
      "  return x;",
      "}",
    ].join("\n");
    expect(compute(src)).toBe(4);
  });

  test("line-comment alone on a line is not counted", () => {
    const src = [
      "function f(){",
      "  // just a comment",
      "  return 1;",
      "}",
    ].join("\n");
    expect(compute(src)).toBe(3);
  });

  test("block comment spanning 3 lines (comment only) contributes 0", () => {
    const src = [
      "function f(){",
      "  /*",
      "   * note",
      "   */",
      "  return 1;",
      "}",
    ].join("\n");
    expect(compute(src)).toBe(3);
  });

  test("inline block comment on a code line counts as 1 code line", () => {
    const src = ["function f(){", "  return /* x */ 1;", "}"].join("\n");
    expect(compute(src)).toBe(3);
  });

  test("arrow expression body single-line → 1", () => {
    const { sourceFile, fn } = parseFirstFunctionLike(
      "const f = (x: number) => x + 1;",
    );
    expect(computeSloc(fn, sourceFile)).toBe(1);
  });

  test("arrow with multi-line body with blanks", () => {
    const { sourceFile, fn } = parseFirstFunctionLike(
      [
        "const f = (x: number) => {",
        "  const y = x;",
        "",
        "  return y;",
        "};",
      ].join("\n"),
    );
    expect(computeSloc(fn, sourceFile)).toBe(4);
  });
});

describe("slocCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function simple(){ return 1; }",
        "export function multi(x: number){",
        "  const y = x;",
        "  return y;",
        "}",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = slocCollector.collect({
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("simple")?.sloc).toBe(1);
    expect(byName.get("multi")?.sloc).toBe(4);
  });
});
