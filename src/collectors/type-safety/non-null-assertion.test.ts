import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeNonNullAssertion,
  nonNullAssertionCollector,
} from "./non-null-assertion.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeNonNullAssertion", () => {
  test("empty body → 0", () => {
    expect(computeNonNullAssertion(parseFn("function f(){}"))).toBe(0);
  });

  test("no non-null assertion → 0", () => {
    expect(
      computeNonNullAssertion(
        parseFn("function f(x: number | null){ return x ?? 0; }"),
      ),
    ).toBe(0);
  });

  test("single `x!` assertion → 1", () => {
    expect(
      computeNonNullAssertion(
        parseFn("function f(x: number | null){ return x!; }"),
      ),
    ).toBe(1);
  });

  test("multiple assertions counted", () => {
    expect(
      computeNonNullAssertion(
        parseFn(
          "function f(a: number | null, b: string | null){ return a! + b!.length; }",
        ),
      ),
    ).toBe(2);
  });

  test("chained non-null on property access", () => {
    expect(
      computeNonNullAssertion(
        parseFn(
          "function f(x: { a?: { b?: number } } | null){ return x!.a!.b!; }",
        ),
      ),
    ).toBe(3);
  });

  test("logical-not `!x` is NOT counted (not NonNullExpression)", () => {
    expect(
      computeNonNullAssertion(parseFn("function f(x: boolean){ return !x; }")),
    ).toBe(0);
  });

  test("nested function assertions do not count for outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(x: number | null){",
        "  function inner(y: number | null){ return y!; }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeNonNullAssertion(outer)).toBe(0);
    expect(computeNonNullAssertion(inner)).toBe(1);
  });

  test("arrow with expression body containing `!` → 1", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number | null) => x!;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeNonNullAssertion(arrow as never)).toBe(1);
  });

  test("arrow with block body containing `!` → counted", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number | null) => { return x!; };",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeNonNullAssertion(arrow as never)).toBe(1);
  });
});

describe("nonNullAssertionCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function safe(x: number | null){ return x ?? 0; }",
        "export function unsafe(x: number | null){ return x!; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = nonNullAssertionCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("safe")?.nonNullAssertionCount).toBe(0);
    expect(byName.get("unsafe")?.nonNullAssertionCount).toBe(1);
  });
});
