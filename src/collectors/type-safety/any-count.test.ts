import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { anyCountCollector, computeAnyCount } from "./any-count.ts";

function parseFn(src: string, strict = true): FunctionDeclaration {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: strict
      ? { strict: true }
      : { strict: false, noImplicitAny: false },
  });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeAnyCount", () => {
  test("no any anywhere → 0", () => {
    expect(
      computeAnyCount(parseFn("function f(x: number): number { return x; }")),
    ).toBe(0);
  });

  test("explicit `: any` on a single parameter → 1", () => {
    expect(
      computeAnyCount(parseFn("function f(x: any): number { return 0; }")),
    ).toBe(1);
  });

  test("explicit `any` in return type → 1", () => {
    expect(
      computeAnyCount(parseFn("function f(x: number): any { return x; }")),
    ).toBe(1);
  });

  test("`let x: any = ...` in body → 1", () => {
    expect(
      computeAnyCount(
        parseFn("function f(): number { let x: any = 1; return x; }"),
      ),
    ).toBe(1);
  });

  test("implicit-any parameter (loose tsconfig) → 1", () => {
    expect(computeAnyCount(parseFn("function f(x) { return x; }", false))).toBe(
      1,
    );
  });

  test("implicit-any variable (loose tsconfig) → 1", () => {
    // `let q;` with no initializer and no annotation resolves to `any`.
    expect(
      computeAnyCount(parseFn("function f() { let q; return q; }", false)),
    ).toBe(1);
  });

  test("explicit `: any` on a parameter does NOT double-count with implicit", () => {
    // Under loose config, an explicit `: any` still counts once (syntactic)
    // and the implicit pass is skipped because getTypeNode() is non-null.
    expect(
      computeAnyCount(parseFn("function f(x: any) { return x; }", false)),
    ).toBe(1);
  });

  test("`any[]` counts as 1 (one AnyKeyword token)", () => {
    expect(
      computeAnyCount(parseFn("function f(xs: any[]): number { return 0; }")),
    ).toBe(1);
  });

  test("multiple syntactic anys sum", () => {
    expect(
      computeAnyCount(
        parseFn(
          "function f(a: any, b: any): any { let x: any = a; return x; }",
        ),
      ),
    ).toBe(4);
  });

  test("nested function's any does not leak out", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(x: number): number {",
        "  function inner(y: any): any { let z: any = y; return z; }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeAnyCount(outer)).toBe(0);
    expect(computeAnyCount(inner)).toBe(3);
  });

  test("array destructuring with concrete types → 0 (not miscounted as any)", () => {
    // Regression: `const [a, b] = ...` creates a VariableDeclaration whose
    // name is an ArrayBindingPattern; its `getType()` reports `any` even when
    // each BindingElement resolves to a concrete type. We must only count
    // the BindingElements, not the wrapping VariableDeclaration.
    expect(
      computeAnyCount(
        parseFn(
          [
            "function split(s: string): [string, number] { return [s, 0]; }",
            "function f(x: string): number {",
            "  const [a, b] = split(x);",
            "  return a.length + b;",
            "}",
          ].join("\n"),
        ),
      ),
    ).toBe(0);
  });

  test("object destructuring with concrete types → 0 (not miscounted as any)", () => {
    expect(
      computeAnyCount(
        parseFn(
          [
            "function f(p: { a: string; b: number }): number {",
            "  const { a, b } = p;",
            "  return a.length + b;",
            "}",
          ].join("\n"),
        ),
      ),
    ).toBe(0);
  });

  test("nested function with implicit any does not leak (loose tsconfig)", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: false, noImplicitAny: false },
    });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(a: number) {",
        "  function inner(y) { return y; }",
        "  return inner(a);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeAnyCount(outer)).toBe(0);
    expect(computeAnyCount(inner)).toBe(1);
  });
});

describe("anyCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function clean(x: number): number { return x; }",
        "export function dirty(x: any): any { let y: any = x; return y; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = anyCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("clean")?.anyCount).toBe(0);
    expect(byName.get("dirty")?.anyCount).toBe(3);
  });
});
