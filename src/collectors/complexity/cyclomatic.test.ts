import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { computeCyclomatic, cyclomaticCollector } from "./cyclomatic.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeCyclomatic", () => {
  test("empty function → 1", () => {
    expect(computeCyclomatic(parseFn("function f(){}"))).toBe(1);
  });

  test("single `if` → 2", () => {
    expect(
      computeCyclomatic(parseFn("function f(x){ if (x) return 1; return 0; }")),
    ).toBe(2);
  });

  test("`if/else` → 2 (else has no increment)", () => {
    expect(
      computeCyclomatic(
        parseFn("function f(x){ if (x) return 1; else return 0; }"),
      ),
    ).toBe(2);
  });

  test("`else if` → 3 (inner IfStatement adds +1)", () => {
    expect(
      computeCyclomatic(
        parseFn(
          "function f(x){ if (x) return 1; else if (x) return 2; return 0; }",
        ),
      ),
    ).toBe(3);
  });

  test("for / for-in / for-of / while / do-while each add +1", () => {
    expect(
      computeCyclomatic(
        parseFn("function f(xs: number[]){ for (let i=0;i<xs.length;i++){} }"),
      ),
    ).toBe(2);
    expect(
      computeCyclomatic(
        parseFn(
          "function f(o: Record<string, number>){ for (const k in o){} }",
        ),
      ),
    ).toBe(2);
    expect(
      computeCyclomatic(
        parseFn("function f(xs: number[]){ for (const x of xs){} }"),
      ),
    ).toBe(2);
    expect(
      computeCyclomatic(parseFn("function f(x: number){ while (x>0) x--; }")),
    ).toBe(2);
    expect(
      computeCyclomatic(
        parseFn("function f(x: number){ do { x--; } while (x>0); }"),
      ),
    ).toBe(2);
  });

  test("switch counts +1 per case (default excluded)", () => {
    expect(
      computeCyclomatic(
        parseFn(
          "function f(x: number){ switch(x){ case 1: return 1; case 2: return 2; case 3: return 3; default: return 0; } }",
        ),
      ),
    ).toBe(4);
  });

  test("try/catch adds +1 for catch", () => {
    expect(
      computeCyclomatic(
        parseFn("function f(){ try { return 1; } catch { return 0; } }"),
      ),
    ).toBe(2);
  });

  test("single logical operator adds +1", () => {
    expect(
      computeCyclomatic(
        parseFn("function f(a: boolean, b: boolean){ return a && b; }"),
      ),
    ).toBe(2);
    expect(
      computeCyclomatic(
        parseFn("function f(a: boolean, b: boolean){ return a || b; }"),
      ),
    ).toBe(2);
    expect(
      computeCyclomatic(
        parseFn("function f(a: number | null, b: number){ return a ?? b; }"),
      ),
    ).toBe(2);
  });

  test("chained `&& && ` adds +1 per operator occurrence", () => {
    expect(
      computeCyclomatic(
        parseFn(
          "function f(a: boolean, b: boolean, c: boolean){ return a && b && c; }",
        ),
      ),
    ).toBe(3);
  });

  test("ternary `?:` adds +1", () => {
    expect(
      computeCyclomatic(parseFn("function f(x: boolean){ return x ? 1 : 0; }")),
    ).toBe(2);
  });

  test("nested function: inner branches do not affect outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(x: number){",
        "  function inner(y: number){ if (y) return 1; if (y < 0) return -1; return 0; }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(inner.getName()).toBe("inner");
    // outer has no branches of its own
    expect(computeCyclomatic(outer)).toBe(1);
    // inner has 2 ifs → 3
    expect(computeCyclomatic(inner)).toBe(3);
  });

  test("arrow with expression body containing ternary → 2", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: boolean) => x ? 1 : 0;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeCyclomatic(arrow as never)).toBe(2);
  });
});

describe("cyclomaticCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function simple(){ return 1; }",
        "export function branchy(x: number){ if (x) return 1; return 0; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = cyclomaticCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("simple")?.cyclomaticComplexity).toBe(1);
    expect(byName.get("branchy")?.cyclomaticComplexity).toBe(2);
  });
});
