import { Project } from "ts-morph";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  parseAllFunctionLikes,
  parseFirstFunctionLike,
} from "../internal/parseFirstFunctionLike.test-helper.ts";
import {
  computeMutationCount,
  mutationCountCollector,
} from "./mutation-count.ts";

function compute(src: string): number {
  const { fn } = parseFirstFunctionLike(src);
  return computeMutationCount(fn);
}

describe("computeMutationCount", () => {
  test("empty function → 0", () => {
    expect(compute("function f(){}")).toBe(0);
  });

  test("const/let declarations are not counted", () => {
    expect(compute("function f(){ const a = 1; let b = 2; return a + b; }")).toBe(
      0,
    );
  });

  test("simple assignment `x = 1` → 1", () => {
    expect(compute("function f(){ let x = 0; x = 1; return x; }")).toBe(1);
  });

  test("compound assignments count", () => {
    expect(
      compute(
        "function f(){ let x = 0; x += 1; x -= 1; x *= 2; x /= 2; x %= 2; x **= 2; x &= 1; x |= 1; x ^= 1; x <<= 1; x >>= 1; x >>>= 1; return x; }",
      ),
    ).toBe(12);
  });

  test("logical compound assignments `&&= ||= ??=` count", () => {
    expect(
      compute(
        "function f(){ let x: number | null = 0; x ||= 1; x &&= 1; x ??= 1; return x; }",
      ),
    ).toBe(3);
  });

  test("`++` and `--` (prefix & postfix) count", () => {
    expect(
      compute("function f(){ let x = 0; x++; ++x; x--; --x; return x; }"),
    ).toBe(4);
  });

  test("unary `+x` / `-x` / `!x` / `~x` do not count", () => {
    expect(
      compute(
        "function f(x: number){ const a = +x; const b = -x; const c = !x; const d = ~x; return a + b + Number(c) + d; }",
      ),
    ).toBe(0);
  });

  test("`delete obj.x` counts", () => {
    expect(
      compute("function f(o: { x?: number }){ delete o.x; return o; }"),
    ).toBe(1);
  });

  test("destructuring assignment counts (as one BinaryExpression)", () => {
    expect(
      compute("function f(){ let a = 0; let b = 0; [a, b] = [1, 2]; return a + b; }"),
    ).toBe(1);
    expect(
      compute("function f(){ let x = 0; ({ x } = { x: 1 }); return x; }"),
    ).toBe(1);
  });

  test("parameter default does not count", () => {
    expect(compute("function f(x: number = 1){ return x; }")).toBe(0);
  });

  test("array methods like push are not counted (name-based not used)", () => {
    expect(
      compute("function f(xs: number[]){ xs.push(1); xs.pop(); return xs; }"),
    ).toBe(0);
  });

  test("for-of loop variable declaration does not count", () => {
    expect(
      compute("function f(xs: number[]){ for (const x of xs) void x; }"),
    ).toBe(0);
  });

  test("class field initializer does not count", () => {
    const { fns } = parseAllFunctionLikes(
      ["class C {", "  x = 1;", "  m(){ return this.x; }", "}"].join("\n"),
    );
    const m = fns.find((f) => f.kind === ts.SyntaxKind.MethodDeclaration);
    if (!m) throw new Error("method not found");
    expect(computeMutationCount(m)).toBe(0);
  });

  test("this.x = 1 inside method counts", () => {
    const { fns } = parseAllFunctionLikes(
      ["class C {", "  x = 0;", "  m(v: number){ this.x = v; }", "}"].join("\n"),
    );
    const m = fns.find((f) => f.kind === ts.SyntaxKind.MethodDeclaration);
    if (!m) throw new Error("method not found");
    expect(computeMutationCount(m)).toBe(1);
  });

  test("equality `==` and strict `===` are not mutations", () => {
    expect(
      compute("function f(a: number, b: number){ return a === b || a == b; }"),
    ).toBe(0);
  });

  test("nested function: inner mutations do not affect outer", () => {
    const { fns } = parseAllFunctionLikes(
      [
        "function outer(){",
        "  function inner(){ let x = 0; x = 1; x++; return x; }",
        "  return inner;",
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
    expect(computeMutationCount(outer)).toBe(0);
    expect(computeMutationCount(inner)).toBe(2);
  });
});

describe("mutationCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function pure(x: number){ return x + 1; }",
        "export function impure(){ let x = 0; x = 1; x++; return x; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = mutationCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("pure")?.mutationSiteCount).toBe(0);
    expect(byName.get("impure")?.mutationSiteCount).toBe(2);
  });
});
