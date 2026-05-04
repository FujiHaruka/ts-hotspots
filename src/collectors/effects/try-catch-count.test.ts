import ts from "typescript";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { mkSourceFiles } from "../internal/mkSourceFiles.test-helper.ts";
import {
  parseAllFunctionLikes,
  parseFirstFunctionLike,
} from "../internal/parseFirstFunctionLike.test-helper.ts";
import {
  computeTryCatchCount,
  tryCatchCountCollector,
} from "./try-catch-count.ts";

function compute(src: string): number {
  const { fn } = parseFirstFunctionLike(src);
  return computeTryCatchCount(fn);
}

describe("computeTryCatchCount", () => {
  test("empty function → 0", () => {
    expect(compute("function f(){}")).toBe(0);
  });

  test("if statements are not counted", () => {
    expect(compute("function f(x: number){ if (x) return 1; }")).toBe(0);
  });

  test("single try/catch → 1", () => {
    expect(compute("function f(){ try { g(); } catch { return 0; } }")).toBe(1);
  });

  test("try/finally (no catch) → 1", () => {
    expect(compute("function f(){ try { g(); } finally { h(); } }")).toBe(1);
  });

  test("multiple try blocks sum up", () => {
    expect(
      compute(
        "function f(){ try { a(); } catch {} try { b(); } catch {} try { c(); } catch {} }",
      ),
    ).toBe(3);
  });

  test("nested try inside try counts both", () => {
    expect(
      compute("function f(){ try { try { a(); } catch {} } catch {} }"),
    ).toBe(2);
  });

  test("nested function: inner try does not affect outer", () => {
    const { fns } = parseAllFunctionLikes(
      [
        "function outer(){",
        "  function inner(){ try { a(); } catch {} try { b(); } catch {} }",
        "  return inner;",
        "}",
      ].join("\n"),
    );
    const outer = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration &&
        f.name?.text === "outer",
    );
    const inner = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration &&
        f.name?.text === "inner",
    );
    if (!outer || !inner) throw new Error("functions not found");
    expect(computeTryCatchCount(outer)).toBe(0);
    expect(computeTryCatchCount(inner)).toBe(2);
  });
});

describe("tryCatchCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function clean(){ return 1; }",
        "export function guarded(){ try { return 1; } catch { return 0; } }",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = tryCatchCountCollector.collect({
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("clean")?.tryCatchCount).toBe(0);
    expect(byName.get("guarded")?.tryCatchCount).toBe(1);
  });
});
