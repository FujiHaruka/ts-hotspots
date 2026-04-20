import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  anyTaintedExpressionCountCollector,
  computeAnyTaintedExpressionCount,
} from "./any-tainted-expression-count.ts";

function parseSingleFn(src: string): FunctionDeclaration {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true },
  });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fns = sf.getFunctions();
  const target = fns[fns.length - 1];
  if (!target) throw new Error("no function in source");
  return target;
}

describe("computeAnyTaintedExpressionCount", () => {
  test("safe expressions (no any) → 0", () => {
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn("function f(s: string): number { return s.length; }"),
      ),
    ).toBe(0);
  });

  test("JSON.parse(s) return is any → 1", () => {
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn(
          "function f(s: string) { const p = JSON.parse(s); return p; }",
        ),
      ),
    ).toBe(1);
  });

  test("property access on an any variable → 1", () => {
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn(
          "declare const a: any;\nfunction f() { const x = a.b; return x; }",
        ),
      ),
    ).toBe(1);
  });

  test("element access on an any variable → 1", () => {
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn(
          "declare const a: any;\nfunction f(k: string) { const x = a[k]; return x; }",
        ),
      ),
    ).toBe(1);
  });

  test("chained `a.b.c` with `a: any` → 2", () => {
    // PropertyAccessExpression nodes: `a.b`, `a.b.c` (both any). `a` itself
    // is an Identifier and therefore excluded.
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn(
          "declare const a: any;\nfunction f() { const x = a.b.c; return x; }",
        ),
      ),
    ).toBe(2);
  });

  test("deeper chain `a.b.c.d` with `a: any` → 3", () => {
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn(
          "declare const a: any;\nfunction f() { const x = a.b.c.d; return x; }",
        ),
      ),
    ).toBe(3);
  });

  test("call whose callee is a typed method does not add extra", () => {
    // `s.length` is a known number, no any. Call of a safe helper too.
    expect(
      computeAnyTaintedExpressionCount(
        parseSingleFn(
          "function f(s: string) { const n = s.length; return n.toString(); }",
        ),
      ),
    ).toBe(0);
  });

  test("nested function any-tainting does not leak to outer", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true },
    });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "declare const a: any;",
        "function outer(s: string) {",
        "  function inner() { const x = a.b.c; return x; }",
        "  return inner();",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    // outer's own body contains only a call to `inner()`, whose return type
    // is inferred (any in this case because inner returns any). That still
    // counts in outer's body (1 call expression resolving to any). Let's
    // verify by computing.
    const outerCount = computeAnyTaintedExpressionCount(outer);
    const innerCount = computeAnyTaintedExpressionCount(inner);
    expect(innerCount).toBe(2); // a.b and a.b.c
    // outer body: `return inner()` — `inner()` resolves to any (call with any
    // return), so that's 1. No access chain outside of that. Ensures outer
    // is NOT picking up the 2 tainted accesses inside inner.
    expect(outerCount).toBe(1);
  });
});

describe("anyTaintedExpressionCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true },
    });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "declare const a: any;",
        "export function clean(s: string) { return s.length; }",
        "export function tainted() { return a.b.c; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = anyTaintedExpressionCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("clean")?.anyTaintedExpressionCount).toBe(0);
    expect(byName.get("tainted")?.anyTaintedExpressionCount).toBe(2);
  });
});
