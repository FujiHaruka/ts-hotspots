import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeTypeAssertionCount,
  typeAssertionCountCollector,
} from "./type-assertion-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeTypeAssertionCount", () => {
  test("empty function → 0", () => {
    expect(computeTypeAssertionCount(parseFn("function f(){}"))).toBe(0);
  });

  test("single `x as number` → 1", () => {
    expect(
      computeTypeAssertionCount(
        parseFn("function f(x: unknown){ return x as number; }"),
      ),
    ).toBe(1);
  });

  test("angle-bracket `<number>x` → 1", () => {
    expect(
      computeTypeAssertionCount(
        parseFn("function f(x: unknown){ return <number>x; }"),
      ),
    ).toBe(1);
  });

  test("`x as const` → 0 (const-assertion excluded)", () => {
    expect(
      computeTypeAssertionCount(parseFn("function f(){ return 1 as const; }")),
    ).toBe(0);
    expect(
      computeTypeAssertionCount(
        parseFn("function f(){ return [1, 2, 3] as const; }"),
      ),
    ).toBe(0);
  });

  test("`x satisfies T` → 0 (not an assertion)", () => {
    expect(
      computeTypeAssertionCount(
        parseFn("function f(){ const x = 1 satisfies number; return x; }"),
      ),
    ).toBe(0);
  });

  test("multiple assertions add up", () => {
    expect(
      computeTypeAssertionCount(
        parseFn(
          "function f(x: unknown){ const a = x as number; const b = <string>x; return (a as unknown) as boolean; }",
        ),
      ),
      // `x as number` + `<string>x` + `x as unknown` + `(x as unknown) as boolean` = 4
    ).toBe(4);
  });

  test("`as const` within a function mixed with real assertion", () => {
    expect(
      computeTypeAssertionCount(
        parseFn(
          "function f(x: unknown){ const a = [1, 2] as const; return x as number; }",
        ),
      ),
    ).toBe(1);
  });

  test("nested function's assertion does not bleed into outer count", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(x: unknown){",
        "  function inner(y: unknown){ return y as number; }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeTypeAssertionCount(outer)).toBe(0);
    expect(computeTypeAssertionCount(inner)).toBe(1);
  });

  test("arrow with expression body containing assertion → 1", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: unknown) => x as number;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeTypeAssertionCount(arrow as never)).toBe(1);
  });
});

describe("typeAssertionCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function none(){ return 1; }",
        "export function one(x: unknown){ return x as number; }",
        "export function two(x: unknown){ const a = x as number; return <string>x; }",
        "export function constOnly(){ return [1, 2] as const; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = typeAssertionCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("none")?.typeAssertionCount).toBe(0);
    expect(byName.get("one")?.typeAssertionCount).toBe(1);
    expect(byName.get("two")?.typeAssertionCount).toBe(2);
    expect(byName.get("constOnly")?.typeAssertionCount).toBe(0);
  });
});
