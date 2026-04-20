import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { computeReturnCount, returnCountCollector } from "./return-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeReturnCount", () => {
  test("empty body → 0", () => {
    expect(computeReturnCount(parseFn("function f(){}"))).toBe(0);
  });

  test("single return → 1", () => {
    expect(computeReturnCount(parseFn("function f(){ return 1; }"))).toBe(1);
  });

  test("multiple returns in if/else → N", () => {
    expect(
      computeReturnCount(
        parseFn(
          "function f(x: boolean){ if (x) return 1; else return 2; return 0; }",
        ),
      ),
    ).toBe(3);
  });

  test("nested function returns do not count toward outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(){",
        "  function inner(){ return 1; }",
        "  return inner();",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(inner.getName()).toBe("inner");
    expect(computeReturnCount(outer)).toBe(1);
    expect(computeReturnCount(inner)).toBe(1);
  });

  test("arrow with expression body → 0", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number) => x + 1;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeReturnCount(arrow as never)).toBe(0);
  });

  test("arrow with block body containing return → 1", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number) => { return x + 1; };",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeReturnCount(arrow as never)).toBe(1);
  });
});

describe("returnCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function noReturn(){ }",
        "export function twoReturns(x: boolean){ if (x) return 1; return 0; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = returnCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("noReturn")?.returnCount).toBe(0);
    expect(byName.get("twoReturns")?.returnCount).toBe(2);
  });
});
