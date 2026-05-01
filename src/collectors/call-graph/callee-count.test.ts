import { Project } from "ts-morph";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  parseAllFunctionLikes,
  parseFirstFunctionLike,
} from "../internal/parseFirstFunctionLike.test-helper.ts";
import { calleeCountCollector, computeCalleeCount } from "./callee-count.ts";

function compute(src: string): number {
  const { fn } = parseFirstFunctionLike(src);
  return computeCalleeCount(fn);
}

describe("computeCalleeCount", () => {
  test("empty function → 0", () => {
    expect(compute("function f(){}")).toBe(0);
  });

  test("single call → 1", () => {
    expect(compute("function f(){ g(); }")).toBe(1);
  });

  test("chained property access call counts once", () => {
    expect(compute("function f(){ a.b.c(); }")).toBe(1);
  });

  test("multiple calls sum up", () => {
    expect(compute("function f(){ g(); h(); i(); }")).toBe(3);
  });

  test("optional call `foo?.()` is counted", () => {
    expect(compute("function f(g?: () => void){ g?.(); return 1; }")).toBe(1);
  });

  test("NewExpression is not counted", () => {
    expect(compute("function f(){ return new Error('x'); }")).toBe(0);
  });

  test("tagged template literal is not counted", () => {
    expect(compute("function f(){ return tag`hi`; }")).toBe(0);
  });

  test("calls nested in expressions are counted", () => {
    expect(compute("function f(){ return g(h()); }")).toBe(2);
  });

  test("nested function: inner calls do not affect outer", () => {
    const { fns } = parseAllFunctionLikes(
      [
        "function outer(){",
        "  function inner(){ a(); b(); c(); }",
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
    expect(computeCalleeCount(outer)).toBe(0);
    expect(computeCalleeCount(inner)).toBe(3);
  });

  test("super() and super.method() are counted", () => {
    const { fns } = parseAllFunctionLikes(
      [
        "class B { m(){} }",
        "class D extends B { constructor(){ super(); super.m(); } }",
      ].join("\n"),
    );
    const ctor = fns.find((f) => f.kind === ts.SyntaxKind.Constructor);
    if (!ctor) throw new Error("ctor not found");
    expect(computeCalleeCount(ctor)).toBe(2);
  });
});

describe("calleeCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function quiet(){ return 1; }",
        "export function noisy(){ a(); b(); return 0; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = calleeCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("quiet")?.calleeCount).toBe(0);
    expect(byName.get("noisy")?.calleeCount).toBe(2);
  });
});
