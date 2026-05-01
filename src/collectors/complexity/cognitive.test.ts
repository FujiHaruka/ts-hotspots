import { describe, expect, test } from "vitest";
import { Project } from "ts-morph";
import ts from "typescript";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  parseAllFunctionLikes,
  parseFirstFunctionLike,
} from "../internal/parseFirstFunctionLike.test-helper.ts";
import { cognitiveCollector, computeCognitive } from "./cognitive.ts";

function compute(src: string): number {
  const { sourceFile, fn } = parseFirstFunctionLike(src);
  return computeCognitive(fn, sourceFile);
}

describe("computeCognitive", () => {
  test("empty function → 0", () => {
    expect(compute("function f(){}")).toBe(0);
  });

  test("single `if` → 1", () => {
    expect(compute("function f(x: number){ if (x) return 1; }")).toBe(1);
  });

  test("`if/else` → 2 (if +1, else +1)", () => {
    expect(
      compute("function f(x: number){ if (x) return 1; else return 0; }"),
    ).toBe(2);
  });

  test("`if / else if / else` → 3 (if +1, else-if +1, else +1)", () => {
    expect(
      compute(
        "function f(x: number){ if (x) return 1; else if (x > 1) return 2; else return 0; }",
      ),
    ).toBe(3);
  });

  test("nested `if` inside `if` → 3 (outer +1, inner +1+1)", () => {
    expect(
      compute(
        "function f(a: boolean, b: boolean){ if (a) { if (b) return 1; } }",
      ),
    ).toBe(3);
  });

  test("nested `for` inside `if` inside `for` → 6 (1 + 2 + 3)", () => {
    expect(
      compute(
        [
          "function f(xs: number[][], flag: boolean){",
          "  for (const row of xs) {",
          "    if (flag) {",
          "      for (const _x of row) {}",
          "    }",
          "  }",
          "}",
        ].join("\n"),
      ),
    ).toBe(6);
  });

  test("ternary at top level → 1", () => {
    expect(compute("function f(x: boolean){ return x ? 1 : 0; }")).toBe(1);
  });

  test("nested ternary inside `if` → 3 (if +1, ternary at nesting 1 → +2)", () => {
    expect(
      compute(
        "function f(a: boolean, b: boolean){ if (a) { return b ? 1 : 0; } return 0; }",
      ),
    ).toBe(3);
  });

  test("switch with 3 cases → 1 (switch itself, cases do not add)", () => {
    expect(
      compute(
        "function f(x: number){ switch(x){ case 1: return 1; case 2: return 2; case 3: return 3; default: return 0; } }",
      ),
    ).toBe(1);
  });

  test("try/catch → 1 (catch +1 at nesting 0)", () => {
    expect(
      compute("function f(){ try { return 1; } catch { return 0; } }"),
    ).toBe(1);
  });

  test("try/catch inside `if` → catch gets nesting bonus", () => {
    // if: +1 (nesting 0); catch: +1 + 1 = +2 (nesting 1 inside if body)
    expect(
      compute(
        "function f(flag: boolean){ if (flag) { try { return 1; } catch { return 0; } } }",
      ),
    ).toBe(3);
  });

  test("logical operators: single operator → 1", () => {
    expect(compute("function f(a: boolean, b: boolean){ return a && b; }")).toBe(
      1,
    );
    expect(compute("function f(a: boolean, b: boolean){ return a || b; }")).toBe(
      1,
    );
  });

  test("logical operators: `a && b && c` → 1 (single run of &&)", () => {
    expect(
      compute(
        "function f(a: boolean, b: boolean, c: boolean){ return a && b && c; }",
      ),
    ).toBe(1);
  });

  test("logical operators: `a && b || c` → 2 (run of &&, run of ||)", () => {
    expect(
      compute(
        "function f(a: boolean, b: boolean, c: boolean){ return a && b || c; }",
      ),
    ).toBe(2);
  });

  test("logical operators: `a && b || c && d` → 3 (three alternating runs)", () => {
    expect(
      compute(
        "function f(a: boolean, b: boolean, c: boolean, d: boolean){ return a && b || c && d; }",
      ),
    ).toBe(3);
  });

  test("nullish coalescing: `a ?? b` → 1; `a ?? b ?? c` → 1", () => {
    expect(
      compute("function f(a: number | null, b: number){ return a ?? b; }"),
    ).toBe(1);
    expect(
      compute(
        "function f(a: number | null, b: number | null, c: number){ return a ?? b ?? c; }",
      ),
    ).toBe(1);
  });

  test("mixing `??` with `&&` → 2 (different operator categories)", () => {
    // `??` cannot mix with `&&`/`||` without parentheses in TS.
    expect(
      compute(
        "function f(a: boolean, b: boolean, c: number){ return (a && b) ?? c; }",
      ),
    ).toBe(2);
  });

  test("direct recursion: `function f(){ return f(); }` → 1", () => {
    expect(compute("function f(): number { return f(); }")).toBe(1);
  });

  test("nested function does not affect outer score", () => {
    const { sourceFile, fns } = parseAllFunctionLikes(
      [
        "function outer(x: number){",
        "  function inner(y: number){ if (y) return 1; if (y < 0) return -1; return 0; }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration && f.name?.text === "outer",
    );
    const inner = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration && f.name?.text === "inner",
    );
    if (!outer || !inner) throw new Error("functions not found");
    // outer: no branches of its own, no recursion → 0
    expect(computeCognitive(outer, sourceFile)).toBe(0);
    // inner: two top-level ifs, each +1 at nesting 0 → 2
    expect(computeCognitive(inner, sourceFile)).toBe(2);
  });

  test("arrow with expression body containing ternary → 1", () => {
    const { sourceFile, fn } = parseFirstFunctionLike(
      "const f = (x: boolean) => x ? 1 : 0;",
    );
    expect(computeCognitive(fn, sourceFile)).toBe(1);
  });

  test("labeled `break` adds +1; plain `break` adds 0", () => {
    // plain break inside for: for +1, break 0 → 1
    expect(
      compute("function f(xs: number[]){ for (const _x of xs) { break; } }"),
    ).toBe(1);
    // labeled break: for +1, labeled break +1 → 2
    expect(
      compute(
        "function f(xs: number[][]){ outer: for (const row of xs) { for (const _x of row) { break outer; } } }",
      ),
    ).toBe(4);
    // verify: outer for +1 (nesting 0), inner for +1+1=+2 (nesting 1), labeled break +1 → 4
  });
});

describe("cognitiveCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function simple(){ return 1; }",
        "export function branchy(x: number, y: number){ if (x) { if (y) return 1; } return 0; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = cognitiveCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("simple")?.cognitiveComplexity).toBe(0);
    // outer if +1, inner if +1+1 → 3
    expect(byName.get("branchy")?.cognitiveComplexity).toBe(3);
  });
});
