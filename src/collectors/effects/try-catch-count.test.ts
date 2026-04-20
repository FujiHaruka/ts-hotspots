import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeTryCatchCount,
  tryCatchCountCollector,
} from "./try-catch-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeTryCatchCount", () => {
  test("empty function → 0", () => {
    expect(computeTryCatchCount(parseFn("function f(){}"))).toBe(0);
  });

  test("if statements are not counted", () => {
    expect(
      computeTryCatchCount(
        parseFn("function f(x: number){ if (x) return 1; }"),
      ),
    ).toBe(0);
  });

  test("single try/catch → 1", () => {
    expect(
      computeTryCatchCount(
        parseFn("function f(){ try { g(); } catch { return 0; } }"),
      ),
    ).toBe(1);
  });

  test("try/finally (no catch) → 1", () => {
    expect(
      computeTryCatchCount(
        parseFn("function f(){ try { g(); } finally { h(); } }"),
      ),
    ).toBe(1);
  });

  test("multiple try blocks sum up", () => {
    expect(
      computeTryCatchCount(
        parseFn(
          "function f(){ try { a(); } catch {} try { b(); } catch {} try { c(); } catch {} }",
        ),
      ),
    ).toBe(3);
  });

  test("nested try inside try counts both", () => {
    expect(
      computeTryCatchCount(
        parseFn("function f(){ try { try { a(); } catch {} } catch {} }"),
      ),
    ).toBe(2);
  });

  test("nested function: inner try does not affect outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(){",
        "  function inner(){ try { a(); } catch {} try { b(); } catch {} }",
        "  return inner;",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeTryCatchCount(outer)).toBe(0);
    expect(computeTryCatchCount(inner)).toBe(2);
  });
});

describe("tryCatchCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function clean(){ return 1; }",
        "export function guarded(){ try { return 1; } catch { return 0; } }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = tryCatchCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("clean")?.tryCatchCount).toBe(0);
    expect(byName.get("guarded")?.tryCatchCount).toBe(1);
  });
});
