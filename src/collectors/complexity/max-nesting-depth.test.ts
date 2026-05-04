import ts from "typescript";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { mkSourceFiles } from "../internal/mkSourceFiles.test-helper.ts";
import {
  parseAllFunctionLikes,
  parseFirstFunctionLike,
} from "../internal/parseFirstFunctionLike.test-helper.ts";
import {
  computeMaxNestingDepth,
  maxNestingDepthCollector,
} from "./max-nesting-depth.ts";

function compute(src: string): number {
  const { fn } = parseFirstFunctionLike(src);
  return computeMaxNestingDepth(fn);
}

describe("computeMaxNestingDepth", () => {
  test("empty body → 0", () => {
    expect(compute("function f(){}")).toBe(0);
  });

  test("single if → 1", () => {
    expect(compute("function f(x: boolean){ if (x) return 1; }")).toBe(1);
  });

  test("if inside if → 2", () => {
    expect(
      compute(
        "function f(x: boolean, y: boolean){ if (x) { if (y) { return 1; } } }",
      ),
    ).toBe(2);
  });

  test("if with while inside → 2", () => {
    expect(
      compute(
        "function f(x: boolean, y: number){ if (x) { while (y) { y--; } } }",
      ),
    ).toBe(2);
  });

  test("for → try/catch → if inside catch → 3", () => {
    expect(
      compute(
        [
          "function f(xs: number[]){",
          "  for (const x of xs) {",
          "    try {",
          "      throw new Error(String(x));",
          "    } catch (e) {",
          "      if (e) { return; }",
          "    }",
          "  }",
          "}",
        ].join("\n"),
      ),
    ).toBe(3);
  });

  test("else if: inner if body is depth 2 (else branch is depth 1, its inner if body is depth 2)", () => {
    expect(
      compute(
        "function f(x: boolean, y: boolean){ if (x) return 1; else if (y) return 2; }",
      ),
    ).toBe(2);
  });

  test("nested function: inner branches do not affect outer", () => {
    const { fns } = parseAllFunctionLikes(
      [
        "function outer(){",
        "  function inner(a: boolean, b: boolean){ if (a) { if (b) { return 1; } } return 0; }",
        "  return inner;",
        "}",
      ].join("\n"),
    );
    const outer = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration &&
        f.name?.text === "outer",
    );
    const inner = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration &&
        f.name?.text === "inner",
    );
    if (!outer || !inner) throw new Error("functions not found");
    expect(computeMaxNestingDepth(outer)).toBe(0);
    expect(computeMaxNestingDepth(inner)).toBe(2);
  });

  test("plain nested block does not add depth", () => {
    expect(compute("function f(){ { const x = 1; } }")).toBe(0);
  });
});

describe("maxNestingDepthCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function flat(){ return 1; }",
        "export function deep(x: boolean, y: boolean){ if (x) { if (y) { return 1; } } return 0; }",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = maxNestingDepthCollector.collect({
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("flat")?.maxNestingDepth).toBe(0);
    expect(byName.get("deep")?.maxNestingDepth).toBe(2);
  });
});
