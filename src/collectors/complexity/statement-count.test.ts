import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeStatementCount,
  statementCountCollector,
} from "./statement-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeStatementCount", () => {
  test("empty function → 0", () => {
    expect(computeStatementCount(parseFn("function f(){}"))).toBe(0);
  });

  test("one return → 1", () => {
    expect(computeStatementCount(parseFn("function f(){ return 1; }"))).toBe(1);
  });

  test("two variable statements + one return → 3", () => {
    expect(
      computeStatementCount(
        parseFn("function f(){ const a = 1; const b = 2; return a + b; }"),
      ),
    ).toBe(3);
  });

  test("nested function: inner statements do not affect outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(x: number){",
        "  function inner(y: number){ const z = y; return z; }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(inner.getName()).toBe("inner");
    // outer: inner declaration (VariableStatement? no — FunctionDeclaration is
    // a statement kind we excluded) + return = 1 statement only (the return).
    // The inner `function` declaration is a nested function and is not
    // traversed, and FunctionDeclaration is not in STATEMENT_KINDS anyway.
    expect(computeStatementCount(outer)).toBe(1);
    // inner: const + return = 2
    expect(computeStatementCount(inner)).toBe(2);
  });

  test("for loop with body containing 2 statements → 3", () => {
    // for itself (+1) + 2 statements inside = 3
    expect(
      computeStatementCount(
        parseFn(
          "function f(xs: number[]){ for (let i=0;i<xs.length;i++){ const x = xs[i]; console.log(x); } }",
        ),
      ),
    ).toBe(3);
  });

  test("arrow expression body → 0", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number) => x + 1;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeStatementCount(arrow as never)).toBe(0);
  });

  test("try/catch with 1 statement in try + 1 in catch → 3", () => {
    // Chosen definition: TryStatement itself counts (+1), statement in try
    // (+1), statement in catch block (+1). Catch clause is not in
    // STATEMENT_KINDS; only the statements inside its block are counted.
    expect(
      computeStatementCount(
        parseFn("function f(){ try { return 1; } catch { return 0; } }"),
      ),
    ).toBe(3);
  });
});

describe("statementCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function simple(){ return 1; }",
        "export function multi(x: number){ const y = x; return y; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = statementCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("simple")?.statementCount).toBe(1);
    expect(byName.get("multi")?.statementCount).toBe(2);
  });
});
